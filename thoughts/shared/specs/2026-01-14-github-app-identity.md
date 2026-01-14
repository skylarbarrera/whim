# GitHub App Identity for Whim

**Status:** Backlog
**Priority:** Low
**Created:** 2026-01-14

## Problem

Currently all PRs, comments, and GitHub API actions appear from the user's personal GitHub account (whoever owns the `GITHUB_TOKEN`). This is confusing and doesn't clearly identify automated actions as coming from Whim.

## Goal

All GitHub actions should appear as `whim[bot]` (or similar), clearly identifying them as automated.

## Solution: GitHub App

### Why GitHub App over Bot Account

| Aspect | Bot Account | GitHub App |
|--------|-------------|------------|
| Identity | Regular user | `app-name[bot]` |
| Org seat | Counts as seat | No seat cost |
| Permissions | All-or-nothing PAT | Fine-grained per-repo |
| Token rotation | Manual | Automatic (1hr tokens) |
| Audit trail | Just another user | Clearly marked as app |

### Implementation Steps

#### 1. Create GitHub App

In GitHub Settings > Developer Settings > GitHub Apps:

- **Name:** `whim` (or `whim-ai`)
- **Homepage URL:** Your docs/repo URL
- **Webhook:** Disabled (we poll, don't need webhooks)
- **Permissions:**
  - Repository: Contents (read/write), Pull requests (read/write), Issues (read/write)
  - No org permissions needed

Save the:
- App ID
- Private key (.pem file)

#### 2. Install App on Repos

Install the app on repos you want Whim to work on. Note the installation ID.

#### 3. Add Token Generation to Orchestrator

```typescript
// packages/orchestrator/src/github-app.ts

import { createAppAuth } from "@octokit/auth-app";

interface GitHubAppConfig {
  appId: string;
  privateKey: string;
  installationId: string;
}

export async function getInstallationToken(config: GitHubAppConfig): Promise<string> {
  const auth = createAppAuth({
    appId: config.appId,
    privateKey: config.privateKey,
    installationId: config.installationId,
  });

  const { token } = await auth({ type: "installation" });
  return token;
}
```

#### 4. Update Worker Spawning

```typescript
// packages/orchestrator/src/workers.ts

// Before spawning worker, get fresh installation token
const githubToken = process.env.GITHUB_APP_PRIVATE_KEY
  ? await getInstallationToken({
      appId: process.env.GITHUB_APP_ID!,
      privateKey: process.env.GITHUB_APP_PRIVATE_KEY,
      installationId: process.env.GITHUB_APP_INSTALLATION_ID!,
    })
  : process.env.GITHUB_TOKEN!;

// Pass to worker container
`GITHUB_TOKEN=${githubToken}`,
```

#### 5. Environment Variables

```bash
# .env - New variables for GitHub App
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n..."
GITHUB_APP_INSTALLATION_ID=98765432

# Keep GITHUB_TOKEN as fallback for local dev
GITHUB_TOKEN=ghp_xxx  # Optional fallback
```

#### 6. Update Git Commit Email (Optional)

To make commits link to the bot on GitHub:

```typescript
// setup.ts - Use GitHub's noreply format
const email = `${appId}+whim[bot]@users.noreply.github.com`;
```

### Dependencies

```bash
bun add @octokit/auth-app
```

### Files to Change

| File | Change |
|------|--------|
| `packages/orchestrator/src/github-app.ts` | New - token generation |
| `packages/orchestrator/src/workers.ts` | Get token before spawn |
| `packages/worker/src/setup.ts` | Update git email format |
| `.env.example` | Add app config vars |
| `docker/docker-compose.yml` | Pass app env vars |

### Estimated Effort

- GitHub App setup: 15 min
- Code changes: 1-2 hours
- Testing: 30 min

### Rollback

Keep `GITHUB_TOKEN` env var support as fallback. If app vars aren't set, use PAT.

## Alternatives Considered

### Bot Account
Create `whim-bot` GitHub account, use its PAT. Simpler but:
- Costs org seat
- Less clear it's automated
- Manual token rotation

### Keep Personal Token
Status quo. Works but confusing who made the PR.

## References

- [GitHub Apps documentation](https://docs.github.com/en/apps)
- [@octokit/auth-app](https://github.com/octokit/auth-app.js)
- [Installation tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)
