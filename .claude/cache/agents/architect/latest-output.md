# Whim Codebase Analysis - Summary
Created: 2025-01-13

## Quick Reference

**What it is**: Autonomous AI dev system that converts GitHub issues to PRs via Claude Code.

**Core flow**: Issue labeled `whim` -> Spec generation -> Queue -> Docker worker (Ralph + Claude Code) -> PR

## Packages

| Package | Purpose |
|---------|---------|
| orchestrator | Queue, worker lifecycle, rate limiting, API |
| worker | Docker container running Ralph/Claude Code |
| intake | GitHub polling, spec generation |
| shared | Types |
| dashboard | Next.js monitoring UI |

## Tech Stack

- TypeScript + Bun + Turbo
- PostgreSQL + pgvector (embeddings)
- Redis (locks, rate limiting)
- Docker (worker containers)
- Express (API)
- Claude API + Claude Code CLI

## Key Custom Code

1. **WorkerManager**: Docker spawning with env injection (Dockerode)
2. **QueueManager**: Priority queue with Postgres
3. **RateLimiter**: Redis counters for daily budget
4. **ConflictDetector**: Redis file locks
5. **Ralph integration**: Claude Code wrapper with JSON event parsing
6. **Spec generation**: Claude API with custom prompts
7. **Learnings**: Vector embeddings for knowledge persistence

## Potential Library Replacements

| Current | Alternative | Benefit |
|---------|-------------|---------|
| Custom queue | BullMQ | Battle-tested, built-in rate limiting |
| Custom file locks | Redlock | Proper distributed lock algorithm |
| Custom rate limiter | BullMQ / rate-limiter-flexible | Proven implementations |

## Keep As-Is

- Docker spawning (unique env injection pattern)
- Ralph integration (project-specific)
- Spec generation (domain-specific prompts)
- Learnings system (custom value-add)

## Full Analysis

See `/Users/skillet/dev/ai/whim/thoughts/shared/plans/whim-codebase-analysis.md`
