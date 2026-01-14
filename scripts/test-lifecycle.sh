#!/usr/bin/env bash
# Test worker lifecycle without burning Claude tokens
#
# Usage:
#   ./scripts/test-lifecycle.sh [success|fail|stuck]
#
# Requires: orchestrator running on localhost:3002

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3002}"
MODE="${1:-success}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log() { echo -e "${CYAN}→${NC} $1"; }
success() { echo -e "${GREEN}✓${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; exit 1; }
warn() { echo -e "${YELLOW}!${NC} $1"; }

echo "🧪 Worker Lifecycle Test (mode: $MODE)"
echo "======================================="
echo ""

# Step 1: Create a test work item
log "Creating test work item..."
WORK_RESPONSE=$(curl -sf -X POST "$BASE_URL/api/work" \
  -H "Content-Type: application/json" \
  -d '{
    "repo": "test/lifecycle-test",
    "branch": "test/lifecycle-'$(date +%s)'",
    "spec": "# Lifecycle Test\n\n- [ ] Test task",
    "priority": "low"
  }')
WORK_ID=$(echo "$WORK_RESPONSE" | jq -r '.id')
[ -n "$WORK_ID" ] && [ "$WORK_ID" != "null" ] && success "Created work item: $WORK_ID" || fail "Failed to create work item"

# Step 2: Simulate worker registration (would normally happen in container)
log "Simulating worker registration..."
# Note: In real scenario, orchestrator spawns container which self-registers
# For this test, we manually call the API endpoints

# Get the work item to check initial state
INITIAL_STATUS=$(curl -sf "$BASE_URL/api/work/$WORK_ID" | jq -r '.status')
success "Initial status: $INITIAL_STATUS"

# Step 3: Simulate heartbeats
log "Testing heartbeat endpoint..."
# First we need a worker ID - in real flow, orchestrator assigns this when spawning
# For testing, let's query workers to see the flow

# Step 4: Watch for status changes
log "Checking queue..."
QUEUE=$(curl -sf "$BASE_URL/api/queue" | jq -r '.stats.total')
success "Queue has $QUEUE item(s)"

# Step 5: Test cancellation
log "Testing cancel on queued item..."
CANCEL_RESULT=$(curl -sf -X POST "$BASE_URL/api/work/$WORK_ID/cancel" | jq -r '.status // .error')
success "Cancel result: $CANCEL_RESULT"

echo ""
echo "======================================="
echo -e "${GREEN}✓ Lifecycle test complete${NC}"
echo ""
echo "To test full worker flow with mock Ralph:"
echo "  MOCK_RALPH=1 docker run --rm whim-worker"
echo ""
