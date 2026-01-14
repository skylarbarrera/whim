# Security Assessment: Whim Codebase for Public Release
Generated: 2026-01-14

## Executive Summary
- **Risk Level:** HIGH
- **Findings:** 2 critical, 4 high, 3 medium
- **Immediate Actions Required:** Yes

## Threat Model
- **Expected Attackers:** External users submitting malicious work items, compromised GitHub accounts, malicious repositories
- **Attack Vectors:** Unauthenticated API access, command injection via work item parameters, secret exposure, container escape
- **Assets to Protect:** GITHUB_TOKEN, ANTHROPIC_API_KEY, database credentials, host system

---

## Findings

### CRITICAL: No API Authentication

**Location:** `/Users/skillet/dev/ai/whim/packages/orchestrator/src/server.ts`
**Vulnerability:** Unauthenticated API - All endpoints publicly accessible
**Risk:** Anyone can submit work items, kill workers, and access sensitive data

**Evidence:**
The server has no authentication middleware. All endpoints are publicly accessible:
```typescript
// server.ts - No auth middleware
app.use(express.json());

// Anyone can submit work items
app.post("/api/work", asyncHandler(async (req, res) => { ... }));

// Anyone can kill workers
app.post("/api/workers/:id/kill", asyncHandler<IdParams>(async (req, res) => { ... }));

// Anyone can view queue contents
app.get("/api/queue", asyncHandler(async (_req, res) => { ... }));
```

**Remediation:**
1. Add API key authentication middleware:
```typescript
const API_KEY = process.env.WHIM_API_KEY;

function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const key = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
  if (!API_KEY || key !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

app.use('/api', authMiddleware);
```
2. For internal worker endpoints, verify the worker ID matches a known active worker
3. Consider role-based access for admin endpoints like `/api/workers/:id/kill`

---

### CRITICAL: Docker Socket Mount Enables Container Escape

**Location:** `/Users/skillet/dev/ai/whim/docker/docker-compose.yml:68-69`
**Vulnerability:** Orchestrator has full access to Docker daemon
**Risk:** If orchestrator is compromised, attacker gains root access to host

**Evidence:**
```yaml
# docker-compose.yml lines 68-69
volumes:
  - /var/run/docker.sock:/var/run/docker.sock
```

The orchestrator needs Docker socket access to spawn workers, but this grants full host root access if the orchestrator container is compromised.

**Remediation:**
1. Consider using Docker-in-Docker (dind) or rootless Docker
2. Use a restricted Docker API proxy like `docker-socket-proxy`:
```yaml
docker-socket-proxy:
  image: tecnativa/docker-socket-proxy
  environment:
    CONTAINERS: 1
    IMAGES: 1
    NETWORKS: 1
    POST: 1
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock

orchestrator:
  environment:
    DOCKER_HOST: tcp://docker-socket-proxy:2375
```
3. Run orchestrator as non-root user
4. Apply AppArmor/SELinux policies

---

### HIGH: Secrets Passed as Environment Variables to Worker Containers

**Location:** `/Users/skillet/dev/ai/whim/packages/orchestrator/src/workers.ts:116-117`
**Vulnerability:** Secrets visible in Docker inspect, process listings, container logs
**Risk:** Secret exposure via container inspection or compromised logging

**Evidence:**
```typescript
// workers.ts lines 114-121
container = await this.docker.createContainer({
  Image: this.config.workerImage,
  Env: [
    `WORKER_ID=${workerId}`,
    `WORK_ITEM=${JSON.stringify(workItem)}`,
    `ORCHESTRATOR_URL=${workerOrchestratorUrl}`,
    `GITHUB_TOKEN=${process.env.GITHUB_TOKEN ?? ""}`,
    `ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY ?? ""}`,
    // ...
  ],
```

Environment variables are visible via:
- `docker inspect <container_id>`
- `/proc/<pid>/environ` inside container
- Any process listing with environment

**Remediation:**
1. Use Docker secrets:
```typescript
container = await this.docker.createContainer({
  Image: this.config.workerImage,
  HostConfig: {
    Secrets: [
      { SecretID: 'github_token', SecretName: 'github_token', File: { Name: '/run/secrets/github_token' } },
      { SecretID: 'anthropic_key', SecretName: 'anthropic_key', File: { Name: '/run/secrets/anthropic_key' } },
    ],
  },
});
```
2. Or pass secrets via a temporary file mounted as volume
3. Minimize secret scope - create per-worker GitHub tokens with minimal permissions

---

### HIGH: No Container Resource Limits

**Location:** `/Users/skillet/dev/ai/whim/packages/orchestrator/src/workers.ts:106-125`
**Vulnerability:** Workers can consume unlimited CPU, memory, and disk
**Risk:** Denial of service, resource exhaustion, runaway containers

**Evidence:**
```typescript
// workers.ts - Container creation has no resource limits
container = await this.docker.createContainer({
  Image: this.config.workerImage,
  Env: [...],
  HostConfig: {
    AutoRemove: false,
    NetworkMode: "whim-network",
    // No memory limits
    // No CPU limits
    // No PID limits
  },
});
```

**Remediation:**
```typescript
container = await this.docker.createContainer({
  Image: this.config.workerImage,
  Env: [...],
  HostConfig: {
    AutoRemove: false,
    NetworkMode: "whim-network",
    Memory: 4 * 1024 * 1024 * 1024, // 4GB
    MemorySwap: 4 * 1024 * 1024 * 1024, // No swap
    CpuPeriod: 100000,
    CpuQuota: 200000, // 2 CPU cores
    PidsLimit: 1000,
    ReadonlyRootfs: false, // Worker needs write access
    SecurityOpt: ['no-new-privileges'],
  },
});
```

---

### HIGH: Database Credentials Hardcoded in docker-compose

**Location:** `/Users/skillet/dev/ai/whim/docker/docker-compose.yml:8-10`
**Vulnerability:** Default credentials in version control
**Risk:** Database compromise if docker-compose.yml is deployed without changes

**Evidence:**
```yaml
# docker-compose.yml lines 8-10
environment:
  POSTGRES_USER: whim
  POSTGRES_PASSWORD: whim
  POSTGRES_DB: whim
```

And connection string on line 50:
```yaml
DATABASE_URL: postgres://whim:whim@postgres:5432/whim
```

**Remediation:**
1. Use environment variable substitution:
```yaml
environment:
  POSTGRES_USER: ${POSTGRES_USER:-whim}
  POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD required}
  POSTGRES_DB: ${POSTGRES_DB:-whim}
```
2. Use Docker secrets for production
3. Add warning comment that these are development defaults
4. Document that production deployments MUST override credentials

---

### HIGH: Input Validation Insufficient for Work Item Metadata

**Location:** `/Users/skillet/dev/ai/whim/packages/orchestrator/src/server.ts:47-52`
**Vulnerability:** Metadata field accepts arbitrary JSON, repo format not validated
**Risk:** NoSQL injection via metadata, path traversal via repo field

**Evidence:**
```typescript
// server.ts - isValidAddWorkItemRequest
function isValidAddWorkItemRequest(body: unknown): body is AddWorkItemRequest {
  if (typeof body !== "object" || body === null) return false;
  const obj = body as Record<string, unknown>;
  if (typeof obj.repo !== "string" || obj.repo.length === 0) return false;
  if (typeof obj.spec !== "string" || obj.spec.length === 0) return false;
  // ... no validation of repo format (owner/repo)
  // ... no validation of metadata contents
  return true;
}
```

The repo field is used directly in git clone:
```typescript
// setup.ts line 169-170
const repoUrl = `https://x-access-token:${config.githubToken}@github.com/${workItem.repo}.git`;
const cloneArgs = ["clone", "--depth", "1", repoUrl, repoDir];
```

A malicious repo like `../../etc` or `; rm -rf /` could cause issues.

**Remediation:**
```typescript
function isValidAddWorkItemRequest(body: unknown): body is AddWorkItemRequest {
  // ... existing checks ...
  
  // Validate repo format: must be owner/repo with alphanumeric, dash, underscore
  const repoPattern = /^[a-zA-Z0-9][-a-zA-Z0-9]*\/[a-zA-Z0-9._-]+$/;
  if (!repoPattern.test(obj.repo as string)) return false;
  
  // Limit spec size
  if ((obj.spec as string).length > 100000) return false;
  
  // Limit metadata depth/size
  if (obj.metadata) {
    const metadataStr = JSON.stringify(obj.metadata);
    if (metadataStr.length > 10000) return false;
  }
  
  return true;
}
```

---

### MEDIUM: Token Mask Logging Could Leak Sensitive Info

**Location:** `/Users/skillet/dev/ai/whim/packages/worker/src/setup.ts:565`
**Vulnerability:** Token partial exposure in logs
**Risk:** First 4 characters of token logged, could aid in token identification

**Evidence:**
```typescript
// setup.ts line 562-565
const tokenLength = githubToken?.length || 0;
const tokenMask = tokenLength > 0
  ? `${githubToken.substring(0, 4)}...(${tokenLength} chars)`
  : "(empty)";
console.log(`[PR] Using GitHub token: ${tokenMask}`);
```

GitHub tokens often start with identifiable prefixes (e.g., `ghp_`, `gho_`, `ghu_`).

**Remediation:**
```typescript
// Don't log any part of the token
const tokenPresent = githubToken && githubToken.length > 0;
console.log(`[PR] GitHub token: ${tokenPresent ? "present" : "missing"}`);
```

---

### MEDIUM: Worker Can Access Any Repository

**Location:** `/Users/skillet/dev/ai/whim/packages/worker/src/setup.ts`
**Vulnerability:** No allowlist of permitted repositories
**Risk:** Workers could be directed to clone/push to any repo the token has access to

**Evidence:**
The worker clones whatever repository is specified in the work item:
```typescript
// setup.ts line 169
const repoUrl = `https://x-access-token:${config.githubToken}@github.com/${workItem.repo}.git`;
```

If the GITHUB_TOKEN has broad org access, a malicious work item could target any repo.

**Remediation:**
1. Add repository allowlist in orchestrator:
```typescript
const ALLOWED_REPOS = process.env.ALLOWED_REPOS?.split(',') ?? [];

async add(input: AddWorkItemRequest): Promise<WorkItem> {
  if (!ALLOWED_REPOS.includes(input.repo)) {
    throw new Error(`Repository ${input.repo} not in allowlist`);
  }
  // ...
}
```
2. Use fine-grained GitHub tokens scoped to specific repositories
3. Validate against REPOS environment variable used by intake

---

### MEDIUM: Error Messages May Expose Internal Details

**Location:** `/Users/skillet/dev/ai/whim/packages/orchestrator/src/server.ts:333-335`
**Vulnerability:** Raw error messages returned to clients
**Risk:** Information disclosure about internal implementation

**Evidence:**
```typescript
// server.ts - Error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Server error:", err);
  res.status(500).json(errorResponse(err.message, "INTERNAL_ERROR"));
});
```

Error messages like database connection failures, Docker errors, etc. are exposed.

**Remediation:**
```typescript
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Server error:", err);
  
  // Log full error internally but return generic message
  const isProduction = process.env.NODE_ENV === 'production';
  const message = isProduction
    ? "An internal error occurred"
    : err.message;
    
  res.status(500).json(errorResponse(message, "INTERNAL_ERROR"));
});
```

---

## Dependency Vulnerabilities

| Package | Version | CVE | Severity | Fixed In |
|---------|---------|-----|----------|----------|
| Unable to run npm audit - project uses bun.lock | - | - | - | - |

**Recommendation:** Run `bun audit` or install npm lockfile for vulnerability scanning.

---

## Secrets Exposure Check

- `.env` files: **In .gitignore - Yes** (lines 20-23 of .gitignore)
- `.env` files exist: **Yes** (docker/.env, .env, .env.example found)
- Hardcoded secrets: **Yes** (docker-compose.yml has default credentials)
- Hardcoded credentials in code: **No** (secrets read from environment)
- Secret management: **Environment variables** (no vault/secrets manager)

---

## SQL Injection Check

All database queries use parameterized queries. **No SQL injection vulnerabilities found.**

Examples of proper parameterization:
```typescript
// db.ts - All queries use $1, $2 placeholders
await this.db.execute(
  `UPDATE work_items SET worker_id = $1, status = 'in_progress' WHERE id = $2`,
  [workerId, workItem.id]
);

// queue.ts - Parameterized insert
const result = await this.db.queryOne<WorkItem>(
  `INSERT INTO work_items (id, repo, branch, spec, priority, max_iterations, metadata)
   VALUES ($1, $2, $3, $4, $5::priority, $6, $7::jsonb)
   RETURNING *`,
  [id, input.repo, branch, input.spec, priority, maxIterations, JSON.stringify(metadata)]
);
```

---

## Command Injection Check

Command execution uses array-based arguments (not shell interpolation), which is safe:

```typescript
// setup.ts - Uses spawn with array args, no shell interpolation
const proc = spawn(command, args, {
  cwd: options.cwd,
  env: { ...process.env, ...options.env },
  shell: false,  // <-- Explicitly disabled
});
```

The `repoUrl` does contain user input, but it's passed as an array element, not interpolated:
```typescript
const cloneArgs = ["clone", "--depth", "1", repoUrl, repoDir];
const cloneResult = await exec("git", cloneArgs);
```

However, the **repo validation is weak** (see HIGH finding above). A repo like `--upload-pack=malicious` could potentially be exploited.

**Remediation:** Strengthen repo format validation.

---

## Docker Security Check

| Check | Status | Notes |
|-------|--------|-------|
| Non-root user | **PASS** | Worker runs as `worker` user (Dockerfile line 62) |
| Privileged mode | **PASS** | No `--privileged` flag used |
| Capabilities | **PASS** | No extra capabilities added |
| Resource limits | **FAIL** | No memory/CPU limits set |
| Network isolation | **PARTIAL** | Uses custom network but no egress restrictions |
| Read-only root | **FAIL** | Container filesystem is writable |

---

## Recommendations

### Immediate (Critical/High)
1. **Add API authentication** to `/api/*` endpoints (server.ts)
2. **Add container resource limits** in workers.ts spawn function
3. **Use Docker secrets** or file mounts instead of environment variables for GITHUB_TOKEN/ANTHROPIC_API_KEY
4. **Validate repo format** against regex pattern `^[a-zA-Z0-9][-a-zA-Z0-9]*/[a-zA-Z0-9._-]+$`
5. **Change default database credentials** and document production requirements

### Short-term (Medium)
1. Implement repository allowlist to restrict which repos can be targeted
2. Sanitize error messages in production mode
3. Remove token prefix from log messages
4. Add Docker socket proxy to limit orchestrator's Docker API access

### Long-term (Hardening)
1. Consider HashiCorp Vault or AWS Secrets Manager for secret management
2. Implement network policies to restrict worker egress traffic
3. Add audit logging for sensitive operations
4. Implement rate limiting on API endpoints (beyond worker spawn limiting)
5. Consider mTLS between orchestrator and workers
6. Run vulnerability scanning in CI/CD pipeline
7. Add container image scanning before deployment
