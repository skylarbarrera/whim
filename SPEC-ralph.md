# Ralph Integration for Factory

## Current State

Ralph already exists at `../ralph/`. It's a working CLI that:
- Spawns `claude` CLI with `--output-format stream-json`
- Passes a prompt telling Claude to work through SPEC.md
- Parses Claude's native stream-json output for UI
- Tracks stats (reads, writes, commands), last commit, elapsed time
- Has nice Ink-based terminal UI
- Runs N iterations or until SPEC is complete

**CLI:**
```bash
ralph run           # 1 iteration
ralph run -n 10     # 10 iterations
ralph run --all     # until SPEC complete (max 100)
```

---

## What Factory Needs from Ralph

The Factory worker needs to:
1. Run Ralph headlessly (no interactive UI)
2. Get structured output for orchestrator heartbeats
3. Know when tasks complete, files change, commits happen
4. Get exit status (success/stuck/failed)

### Option A: Headless Mode with JSON Events

Add `--headless` flag that emits JSON events to stdout instead of Ink UI:

```bash
ralph run --headless -n 10
```

**Output format:**
```jsonl
{"event":"started","spec":"SPEC.md","tasks":5,"timestamp":"..."}
{"event":"iteration","n":1,"phase":"working"}
{"event":"tool","type":"read","path":"src/api.ts"}
{"event":"tool","type":"write","path":"src/api.ts"}
{"event":"commit","hash":"abc123","message":"feat: add endpoint"}
{"event":"task_complete","index":0,"text":"Add API endpoint"}
{"event":"iteration_done","n":1,"duration_ms":45000,"stats":{...}}
{"event":"complete","tasks_done":5,"total_duration_ms":180000}
```

### Option B: Use Existing stream-json Passthrough

Ralph already parses Claude's `stream-json`. Factory worker could:
1. Spawn Ralph normally
2. Ralph spawns Claude with `stream-json`
3. Add flag to have Ralph passthrough or re-emit events

### Option C: Factory Spawns Claude Directly

Skip Ralph entirely. Factory worker:
1. Writes SPEC.md to workspace
2. Spawns `claude --dangerously-skip-permissions --output-format stream-json -p "..."`
3. Parses stream-json directly
4. Handles iteration logic itself

**Tradeoff:** Duplicates Ralph's iteration logic but gives Factory full control.

---

## Recommended: Option A (Headless Mode)

Add minimal changes to Ralph for Factory integration.

### Phase 1: Add Headless Flag

- [ ] Add `--headless` flag to CLI
- [ ] When headless, skip Ink render, use JSON event emitter
- [ ] Emit events to stdout in JSONL format

### Phase 2: Event Types

- [ ] `started` - Ralph started, spec loaded
- [ ] `iteration` - Iteration N started
- [ ] `tool` - Claude used a tool (read/write/bash)
- [ ] `commit` - Git commit detected
- [ ] `task_complete` - Checkbox marked done in SPEC
- [ ] `iteration_done` - Iteration N finished with stats
- [ ] `stuck` - No progress after threshold
- [ ] `complete` - All tasks done
- [ ] `failed` - Unrecoverable error

### Phase 3: Exit Codes

- [ ] Exit 0 = All tasks complete
- [ ] Exit 1 = Stuck (no progress)
- [ ] Exit 2 = Max iterations reached
- [ ] Exit 3 = Fatal error

### Phase 4: Stuck Detection

- [ ] Track consecutive iterations without task completion
- [ ] After N iterations with no checkbox change → stuck
- [ ] Configurable via `--stuck-threshold N` (default 3)

---

## Implementation Details

### Headless Event Emitter

```typescript
// src/lib/headless-emitter.ts

export type RalphEvent =
  | { event: 'started'; spec: string; tasks: number }
  | { event: 'iteration'; n: number; phase: string }
  | { event: 'tool'; type: 'read' | 'write' | 'bash'; path?: string }
  | { event: 'commit'; hash: string; message: string }
  | { event: 'task_complete'; index: number; text: string }
  | { event: 'iteration_done'; n: number; duration_ms: number; stats: Stats }
  | { event: 'stuck'; reason: string; iterations_without_progress: number }
  | { event: 'complete'; tasks_done: number; total_duration_ms: number }
  | { event: 'failed'; error: string };

export function emit(event: RalphEvent): void {
  console.log(JSON.stringify(event));
}
```

### CLI Changes

```typescript
// In cli.tsx

program
  .command('run')
  .option('--headless', 'Output JSON events instead of UI')
  .option('--stuck-threshold <n>', 'Iterations without progress before stuck', '3')
  .action((options) => {
    if (options.headless) {
      executeHeadlessRun(options);
    } else {
      executeRun(options);  // existing Ink UI
    }
  });
```

### Headless Runner

```typescript
// src/lib/headless-runner.ts

export async function executeHeadlessRun(options: RunOptions): Promise<void> {
  const spec = loadSpec(options.cwd);
  emit({ event: 'started', spec: 'SPEC.md', tasks: spec.tasks.length });

  let iterationsWithoutProgress = 0;

  for (let i = 1; i <= options.iterations; i++) {
    const tasksBefore = countCompleteTasks(spec);

    emit({ event: 'iteration', n: i, phase: 'starting' });

    const result = await runSingleIteration(options);

    // Re-parse spec to check progress
    const updatedSpec = loadSpec(options.cwd);
    const tasksAfter = countCompleteTasks(updatedSpec);

    if (tasksAfter > tasksBefore) {
      iterationsWithoutProgress = 0;
      emit({ event: 'task_complete', index: tasksAfter - 1, text: '...' });
    } else {
      iterationsWithoutProgress++;
    }

    emit({ event: 'iteration_done', n: i, duration_ms: result.durationMs, stats: result.stats });

    if (iterationsWithoutProgress >= options.stuckThreshold) {
      emit({ event: 'stuck', reason: 'No task progress', iterations_without_progress: iterationsWithoutProgress });
      process.exit(1);
    }

    if (isSpecComplete(updatedSpec)) {
      emit({ event: 'complete', tasks_done: tasksAfter, total_duration_ms: totalDuration });
      process.exit(0);
    }
  }

  // Max iterations reached
  process.exit(2);
}
```

---

## Factory Worker Integration

With headless Ralph, the Factory worker becomes simple:

```typescript
// packages/worker/src/ralph.ts

import { spawn } from 'child_process';
import { createInterface } from 'readline';

export async function runRalph(workspace: string, client: OrchestratorClient): Promise<RalphResult> {
  const ralph = spawn('ralph', ['run', '--headless', '--all'], {
    cwd: workspace,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const rl = createInterface({ input: ralph.stdout });

  for await (const line of rl) {
    const event = JSON.parse(line);

    switch (event.event) {
      case 'iteration':
        await client.heartbeat({ iteration: event.n, phase: event.phase });
        break;
      case 'tool':
        if (event.type === 'write') {
          await client.lockFile(event.path);
        }
        break;
      case 'commit':
        // Track commits for PR
        break;
      case 'stuck':
        await client.stuck(event.reason, event.iterations_without_progress);
        break;
    }
  }

  const exitCode = await new Promise<number>((resolve) => {
    ralph.on('close', resolve);
  });

  return { exitCode, /* ... */ };
}
```

---

## Summary

| What | Where |
|------|-------|
| Ralph core loop | Already exists in `../ralph/` |
| Headless mode | New feature needed |
| Event format | JSONL to stdout |
| Stuck detection | New feature needed |
| Exit codes | Standardize |

**Estimated work:** 1-2 days to add headless mode to existing Ralph.
