#!/usr/bin/env bash
# Test learnings pipeline via API
# Requires: postgres running, orchestrator running

set -euo pipefail

API_URL="${API_URL:-http://localhost:3002}"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

success() { echo -e "${GREEN}✓${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; exit 1; }

echo "Testing Learnings Pipeline"
echo "=========================="

# 1. Create a work item
echo "Creating work item..."
WORK_RESPONSE=$(curl -sf -X POST "$API_URL/api/work" \
  -H "Content-Type: application/json" \
  -d '{"repo": "test/learnings-test", "spec": "# Test\n- [ ] Test task", "priority": "low"}')

WORK_ID=$(echo "$WORK_RESPONSE" | jq -r '.id')
if [[ "$WORK_ID" == "null" || -z "$WORK_ID" ]]; then
  echo "$WORK_RESPONSE"
  fail "Failed to create work item"
fi
success "Work item created: $WORK_ID"

# 2. Register a worker
echo "Registering worker..."
WORKER_RESPONSE=$(curl -sf -X POST "$API_URL/api/worker/register" \
  -H "Content-Type: application/json" \
  -d "{\"workItemId\": \"$WORK_ID\"}")

WORKER_ID=$(echo "$WORKER_RESPONSE" | jq -r '.worker.id')
if [[ "$WORKER_ID" == "null" || -z "$WORKER_ID" ]]; then
  echo "$WORKER_RESPONSE"
  fail "Failed to register worker"
fi
success "Worker registered: $WORKER_ID"

# 3. Complete with learnings
echo "Completing worker with learnings..."
COMPLETE_RESPONSE=$(curl -sf -X POST "$API_URL/api/worker/$WORKER_ID/complete" \
  -H "Content-Type: application/json" \
  -d '{
    "metrics": {
      "tokensIn": 1000,
      "tokensOut": 500,
      "duration": 5000,
      "filesModified": 2,
      "testsRun": 5,
      "testsPassed": 5,
      "testsFailed": 0
    },
    "learnings": [
      {"content": "Test learning 1: Always validate input before processing", "spec": "# Test spec"},
      {"content": "Test learning 2: Use early returns to reduce nesting", "spec": "# Test spec"}
    ]
  }')

success "Worker completed with learnings"

# 4. Query learnings from DB
echo "Querying learnings..."
sleep 1  # Give DB time to commit

LEARNINGS=$(curl -sf "$API_URL/api/learnings?repo=test/learnings-test")
LEARNING_COUNT=$(echo "$LEARNINGS" | jq 'length')

if [[ "$LEARNING_COUNT" -ge 2 ]]; then
  success "Found $LEARNING_COUNT learnings in database"
  echo ""
  echo "Learnings stored:"
  echo "$LEARNINGS" | jq -r '.[] | "  - \(.content | .[0:60])..."'
else
  echo "$LEARNINGS"
  fail "Expected at least 2 learnings, got $LEARNING_COUNT"
fi

echo ""
echo "=========================="
echo -e "${GREEN}Learnings pipeline test passed!${NC}"
