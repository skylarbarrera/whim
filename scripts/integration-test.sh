#!/usr/bin/env bash
# Integration test for Whim
# Tests full stack including docker-proxy security fix
#
# Usage:
#   ./scripts/integration-test.sh          # Uses MOCK_RALPH mode (no real tokens needed)
#   ./scripts/integration-test.sh --real   # Uses real tokens from .env (tests actual worker)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

success() { echo -e "${GREEN}✓${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; exit 1; }
info() { echo -e "${YELLOW}→${NC} $1"; }

# Parse args
MOCK_MODE=true
if [[ "${1:-}" == "--real" ]]; then
  MOCK_MODE=false
  info "Running with real tokens (will spawn actual worker)"
else
  info "Running in MOCK mode (no real tokens needed)"
fi

cleanup() {
  info "Cleaning up..."
  docker compose -f docker/docker-compose.yml down -v 2>/dev/null || true
  # Remove any spawned worker containers
  docker ps -aq --filter "ancestor=whim-worker" | xargs -r docker rm -f 2>/dev/null || true
}
trap cleanup EXIT

echo ""
echo "=========================================="
echo "  Whim Integration Test"
echo "=========================================="
echo ""

# 1. Build images
info "Building Docker images..."
docker build -t whim-worker -f packages/worker/Dockerfile . -q
docker build -t whim-orchestrator -f packages/orchestrator/Dockerfile . -q
success "Images built"

# 2. Create env file
info "Setting up environment..."
if [[ "$MOCK_MODE" == true ]]; then
  cat > docker/.env << 'EOF'
GITHUB_TOKEN=test-token
ANTHROPIC_API_KEY=test-key
REPOS=test/repo
MOCK_RALPH=true
EOF
else
  if [[ ! -f .env ]]; then
    fail "No .env file found. Create one with GITHUB_TOKEN and ANTHROPIC_API_KEY"
  fi
  cp .env docker/.env
fi
success "Environment configured"

# 3. Start services
info "Starting services..."
docker compose -f docker/docker-compose.yml up -d postgres redis docker-proxy
sleep 5

# Wait for docker-proxy health
for i in {1..10}; do
  if docker inspect whim-docker-proxy --format='{{.State.Health.Status}}' 2>/dev/null | grep -q healthy; then
    break
  fi
  sleep 1
done
success "Core services started"

# Start orchestrator
docker compose -f docker/docker-compose.yml up -d orchestrator
sleep 10
success "Orchestrator started"

# 4. Health checks
info "Running health checks..."
docker ps --format "table {{.Names}}\t{{.Status}}" | grep whim

if ! curl -sf http://localhost:3002/health > /dev/null; then
  docker logs whim-orchestrator
  fail "Orchestrator health check failed"
fi
success "Orchestrator healthy"

# 5. Verify docker-proxy connection
info "Verifying docker-proxy connection..."
if docker logs whim-orchestrator 2>&1 | grep -q "tcp://docker-proxy:2375"; then
  success "Docker socket proxy connected"
else
  docker logs whim-orchestrator
  fail "Orchestrator not using docker-proxy"
fi

# 6. Test API
info "Testing API endpoints..."
curl -sf http://localhost:3002/api/status | jq -e '.queue' > /dev/null
success "GET /api/status"

curl -sf http://localhost:3002/api/queue | jq -e '.items' > /dev/null
success "GET /api/queue"

# 7. Test work item submission
info "Submitting test work item..."
RESPONSE=$(curl -sf -X POST http://localhost:3002/api/work \
  -H "Content-Type: application/json" \
  -d '{"repo": "test/integration-test", "spec": "# Test\\n\\n- [ ] Say hello", "priority": "high"}')

WORK_ID=$(echo "$RESPONSE" | jq -r '.id')
if [[ "$WORK_ID" == "null" || -z "$WORK_ID" ]]; then
  echo "$RESPONSE"
  fail "Failed to create work item"
fi
success "Work item created: $WORK_ID"

# 8. Wait for worker spawn
info "Waiting for worker spawn..."
for i in {1..12}; do
  if docker logs whim-orchestrator 2>&1 | grep -q "Spawned worker"; then
    SPAWN_LOG=$(docker logs whim-orchestrator 2>&1 | grep "Spawned worker" | tail -1)
    success "Worker spawned: $SPAWN_LOG"
    break
  fi
  if [[ $i -eq 12 ]]; then
    fail "Worker spawn timeout (60s)"
  fi
  sleep 5
done

# 9. Check worker ran (will fail on fake repo, but proves spawn worked)
sleep 5
WORKER_CONTAINERS=$(docker ps -a --filter "ancestor=whim-worker" --format "{{.ID}}" | head -1)
if [[ -n "$WORKER_CONTAINERS" ]]; then
  info "Worker container logs:"
  docker logs "$WORKER_CONTAINERS" 2>&1 | head -20
  success "Worker container executed"
else
  info "No worker container found (may have been cleaned up)"
fi

echo ""
echo "=========================================="
echo -e "  ${GREEN}All integration tests passed!${NC}"
echo "=========================================="
echo ""
echo "Summary:"
echo "  - Docker socket proxy: Working"
echo "  - Orchestrator: Connected via tcp://docker-proxy:2375"
echo "  - API: Responding"
echo "  - Worker spawn: Successful"
echo ""
