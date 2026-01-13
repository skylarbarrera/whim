#!/usr/bin/env bash
# AI Software Factory - Development Script
# Hot-reload development with auto-rebuilding worker image

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

success() { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
error() { echo -e "${RED}✗${NC} $1"; exit 1; }
info() { echo -e "${BLUE}ℹ${NC} $1"; }

# Parse arguments
MODE="local"  # local or docker

while [[ $# -gt 0 ]]; do
    case $1 in
        --docker)
            MODE="docker"
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --docker    Run everything in Docker (no hot reload)"
            echo "  -h, --help  Show this help"
            echo ""
            echo "Default: Run services locally with hot reload"
            exit 0
            ;;
        *)
            error "Unknown option: $1"
            ;;
    esac
done

echo "🏭 AI Software Factory - Development Mode"
echo "=========================================="
echo ""

# Check prerequisites
if ! command -v docker &> /dev/null; then
    error "Docker is required but not installed"
fi

if ! docker info &> /dev/null 2>&1; then
    error "Docker is not running"
fi

# Check .env exists
if [ ! -f "docker/.env" ]; then
    warn "No docker/.env file found. Run ./scripts/setup.sh first."
    exit 1
fi

# Load env
set -a
source docker/.env
set +a

if [ "$MODE" = "docker" ]; then
    # Docker mode - just run everything in containers
    info "Starting all services in Docker..."
    cd docker
    docker compose up --build -d
    docker compose logs -f
    exit 0
fi

# Local hot-reload mode
info "Starting local development with hot reload..."

# Cleanup on exit
PIDS=()
cleanup() {
    echo ""
    info "Shutting down..."
    for pid in "${PIDS[@]}"; do
        kill "$pid" 2>/dev/null || true
    done
    exit 0
}
trap cleanup SIGINT SIGTERM EXIT

# Start infra in Docker
info "Starting infrastructure (postgres, redis)..."
docker compose -f docker/docker-compose.yml up -d postgres redis

# Wait for postgres
info "Waiting for postgres..."
until docker exec factory-postgres pg_isready -U factory -d factory > /dev/null 2>&1; do
    sleep 1
done
success "Postgres ready"

# Build shared first
info "Building shared package..."
(cd packages/shared && bun run build)
success "Shared package built"

# Build worker image
info "Building worker Docker image..."
docker build -t factory-worker -f packages/worker/Dockerfile . -q
success "Worker image built"

# Start worker watcher in background
info "Starting worker code watcher..."
(
    LAST_HASH=""
    while true; do
        # Compute hash of worker and shared source files
        HASH=$(find packages/worker/src packages/shared/src -type f -name "*.ts" -exec cat {} \; 2>/dev/null | md5 || echo "")
        if [ "$HASH" != "$LAST_HASH" ] && [ -n "$LAST_HASH" ]; then
            echo -e "${YELLOW}[worker]${NC} Code changed, rebuilding image..."
            (cd packages/shared && bun run build) 2>/dev/null
            docker build -t factory-worker -f packages/worker/Dockerfile . -q 2>/dev/null && \
            echo -e "${GREEN}[worker]${NC} Image rebuilt"
        fi
        LAST_HASH="$HASH"
        sleep 2
    done
) &
PIDS+=($!)

# Env vars already loaded from docker/.env via set -a
# Just set additional vars for local dev
export ORCHESTRATOR_URL="http://localhost:3000"
export PORT=3000

info "Using DATABASE_URL: ${DATABASE_URL}"

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Orchestrator:  http://localhost:3000${NC}"
echo -e "${GREEN}  Dashboard:     http://localhost:3001${NC}"
echo -e "${GREEN}  Worker image:  auto-rebuilds on code changes${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Run services with hot reload
info "Starting orchestrator..."
(cd packages/orchestrator && bun --watch src/index.ts 2>&1 | sed 's/^/[orchestrator] /') &
PIDS+=($!)

sleep 1

info "Starting intake..."
(cd packages/intake && bun --watch src/index.ts 2>&1 | sed 's/^/[intake] /') &
PIDS+=($!)

sleep 1

info "Starting dashboard..."
(cd packages/dashboard && PORT=3001 bun run dev 2>&1 | sed 's/^/[dashboard] /') &
PIDS+=($!)

echo ""
success "All services running. Press Ctrl+C to stop."
echo ""

# Wait for any process to exit
wait
