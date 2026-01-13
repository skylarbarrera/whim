# Phase 8: Scripts

## Goal
Create setup, migration, and development scripts for the AI Software Factory.

## Files to Create
- `scripts/setup.sh` - One-time project setup (prerequisites, .env, deps, images, services, migrations)
- `scripts/migrate.sh` - Database migration runner
- `scripts/dev.sh` - Development environment launcher

## Exit Criteria
1. All three scripts created and executable
2. `scripts/setup.sh` checks for docker/bun, creates .env, installs deps, builds worker image, starts postgres/redis, runs migrations
3. `scripts/migrate.sh` runs SQL migrations against database
4. `scripts/dev.sh` starts dev environment with docker-compose
5. All existing tests pass
6. Type checks pass
