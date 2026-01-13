# Phase 7: Docker Infrastructure

## Goal
Create Docker infrastructure with docker-compose.yml that orchestrates all services (postgres, redis, orchestrator, intake, dashboard placeholder).

## Files to Create
- `docker/docker-compose.yml` - Complete service definitions

## Exit Criteria
- [x] `docker/docker-compose.yml` exists with all required services
- [x] Services configured: postgres (pgvector), redis, orchestrator, intake, dashboard
- [x] Volumes defined for postgres_data and redis_data
- [x] All services have proper environment variables and dependencies
- [x] Network configuration allows inter-service communication

## Implementation Steps
1. Create `docker/` directory
2. Create `docker/docker-compose.yml` with:
   - postgres service (pgvector/pgvector:pg16)
   - redis service (redis:7-alpine)
   - orchestrator service (depends on postgres, redis)
   - intake service (depends on orchestrator)
   - dashboard service placeholder (depends on orchestrator)
   - Named volumes for persistence
   - Health checks for dependencies
