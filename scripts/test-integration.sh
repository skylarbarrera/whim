#!/usr/bin/env bash
# Whim - Integration Test
# Verifies the factory API is working correctly

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3002}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

success() { echo -e "${GREEN}✓${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; exit 1; }
info() { echo -e "${YELLOW}→${NC} $1"; }

echo "🧪 Whim - Integration Tests"
echo "==========================================="
echo "Base URL: $BASE_URL"
echo ""

# Test 1: Health check
info "Testing /health..."
HEALTH=$(curl -sf "$BASE_URL/health" | jq -r '.status')
[ "$HEALTH" = "ok" ] && success "Health check passed" || fail "Health check failed"

# Test 2: Status endpoint
info "Testing /api/status..."
STATUS=$(curl -sf "$BASE_URL/api/status" | jq -r '.status')
[ "$STATUS" = "healthy" ] && success "Status endpoint passed" || fail "Status endpoint failed"

# Test 3: Create work item
info "Creating test work item..."
WORK_RESPONSE=$(curl -sf -X POST "$BASE_URL/api/work" \
  -H "Content-Type: application/json" \
  -d '{
    "repo": "test/integration-test",
    "spec": "# Integration Test\n\n- [ ] Test task 1\n- [ ] Test task 2",
    "priority": "low"
  }')
WORK_ID=$(echo "$WORK_RESPONSE" | jq -r '.id')
[ -n "$WORK_ID" ] && [ "$WORK_ID" != "null" ] && success "Created work item: $WORK_ID" || fail "Failed to create work item"

# Test 4: Get work item
info "Retrieving work item..."
WORK_STATUS=$(curl -sf "$BASE_URL/api/work/$WORK_ID" | jq -r '.status')
[ "$WORK_STATUS" = "queued" ] && success "Work item status is 'queued'" || fail "Unexpected status: $WORK_STATUS"

# Test 5: Queue stats
info "Checking queue..."
QUEUE_TOTAL=$(curl -sf "$BASE_URL/api/queue" | jq -r '.stats.total')
[ "$QUEUE_TOTAL" -ge 1 ] && success "Queue has $QUEUE_TOTAL item(s)" || fail "Queue is empty"

# Test 6: Workers list
info "Checking workers..."
WORKERS=$(curl -sf "$BASE_URL/api/workers")
WORKER_COUNT=$(echo "$WORKERS" | jq 'length')
success "Workers endpoint returned: $WORKER_COUNT worker(s)"

# Test 7: Metrics
info "Checking metrics..."
METRICS=$(curl -sf "$BASE_URL/api/metrics")
success "Metrics endpoint returned data"

# Test 8: Cancel work item (may fail if already picked up by orchestrator loop)
info "Cancelling test work item..."
CANCEL_HTTP=$(curl -s -w "%{http_code}" -X POST "$BASE_URL/api/work/$WORK_ID/cancel")
CANCEL_CODE="${CANCEL_HTTP: -3}"
CANCEL_BODY="${CANCEL_HTTP%???}"
if [ "$CANCEL_CODE" = "200" ]; then
  success "Work item cancelled"
else
  # Check if it's the expected "not cancellable" error
  ERROR_CODE=$(echo "$CANCEL_BODY" | jq -r '.code // empty')
  if [ "$ERROR_CODE" = "INVALID_STATE" ]; then
    success "Work item not cancellable (already processed) - expected behavior"
  else
    fail "Unexpected cancel error: $CANCEL_BODY"
  fi
fi

echo ""
echo "==========================================="
echo -e "${GREEN}🎉 All integration tests passed!${NC}"
echo ""
