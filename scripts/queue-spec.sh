#!/usr/bin/env bash
set -euo pipefail

# Load .env if present (for ORCHESTRATOR_URL, API_KEY, etc.)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$SCRIPT_DIR/../.env" ]]; then
  set -a
  source "$SCRIPT_DIR/../.env"
  set +a
fi

ORCHESTRATOR_URL="${ORCHESTRATOR_URL:-http://localhost:3002}"

usage() {
  echo "Usage: $0 <repo> <spec-file> [priority]"
  echo ""
  echo "Arguments:"
  echo "  repo       Repository in owner/repo format"
  echo "  spec-file  Path to SPEC.md file"
  echo "  priority   Optional: low, medium (default), high, critical"
  echo ""
  echo "Environment:"
  echo "  ORCHESTRATOR_URL  API URL (loaded from .env or default: http://localhost:3002)"
  echo "  API_KEY           API key if auth is enabled"
  echo ""
  echo "Example:"
  echo "  $0 myorg/myrepo SPEC-cli.md high"
  exit 1
}

if [[ $# -lt 2 ]]; then
  usage
fi

REPO="$1"
SPEC_FILE="$2"
PRIORITY="${3:-medium}"

if [[ ! -f "$SPEC_FILE" ]]; then
  echo "Error: Spec file not found: $SPEC_FILE"
  exit 1
fi

if [[ ! "$REPO" =~ ^[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+$ ]]; then
  echo "Error: Invalid repo format. Expected owner/repo, got: $REPO"
  exit 1
fi

SPEC_CONTENT=$(cat "$SPEC_FILE")

AUTH_HEADER=""
if [[ -n "${API_KEY:-}" ]]; then
  AUTH_HEADER="-H \"X-API-Key: $API_KEY\""
fi

PAYLOAD=$(jq -n \
  --arg repo "$REPO" \
  --arg spec "$SPEC_CONTENT" \
  --arg priority "$PRIORITY" \
  '{repo: $repo, spec: $spec, priority: $priority}')

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$ORCHESTRATOR_URL/api/work" \
  -H "Content-Type: application/json" \
  ${API_KEY:+-H "X-API-Key: $API_KEY"} \
  -d "$PAYLOAD")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [[ "$HTTP_CODE" -ge 200 && "$HTTP_CODE" -lt 300 ]]; then
  WORK_ID=$(echo "$BODY" | jq -r '.id')
  echo "Queued successfully!"
  echo "  Work ID:  $WORK_ID"
  echo "  Repo:     $REPO"
  echo "  Priority: $PRIORITY"
  echo "  Status:   $(echo "$BODY" | jq -r '.status')"
else
  echo "Error: Failed to queue spec (HTTP $HTTP_CODE)"
  echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
  exit 1
fi
