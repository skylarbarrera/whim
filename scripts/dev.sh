#!/usr/bin/env bash
# Whim - Development Script
# Uses Docker Compose for all orchestration

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

# Load .env for port variables
if [[ -f ".env" ]]; then
  set -a
  source .env
  set +a
fi

# Port defaults
POSTGRES_PORT="${POSTGRES_PORT:-5433}"
REDIS_PORT="${REDIS_PORT:-6380}"
ORCHESTRATOR_PORT="${ORCHESTRATOR_PORT:-3002}"

# Colors
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
MODE="watch"  # watch (hot-reload) or up (static)

while [[ $# -gt 0 ]]; do
    case $1 in
        --no-watch)
            MODE="up"
            shift
            ;;
        --down|down)
            info "Stopping all services..."
            docker compose -f docker/docker-compose.yml -f docker/docker-compose.dev.yml down
            success "All services stopped"
            exit 0
            ;;
        --logs|logs)
            docker compose -f docker/docker-compose.yml logs -f
            exit 0
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  (default)     Start with hot-reload (docker compose watch)"
            echo "  --no-watch    Start without hot-reload"
            echo "  --down        Stop all services"
            echo "  --logs        Follow logs"
            echo "  -h, --help    Show this help"
            exit 0
            ;;
        *)
            error "Unknown option: $1"
            ;;
    esac
done

echo "🏭 Whim - Development Mode"
echo "=========================================="
echo ""

# Check prerequisites
command -v docker &> /dev/null || error "Docker is required but not installed"
docker info &> /dev/null 2>&1 || error "Docker is not running"

# Check Docker Compose version supports watch
COMPOSE_VERSION=$(docker compose version --short 2>/dev/null || echo "0")
if [[ "$MODE" == "watch" ]] && ! printf '%s\n' "2.22.0" "$COMPOSE_VERSION" | sort -V | head -1 | grep -q "2.22.0"; then
    warn "Docker Compose $COMPOSE_VERSION doesn't support watch mode (needs 2.22+)"
    warn "Falling back to standard mode. Upgrade Docker Desktop for hot-reload."
    MODE="up"
fi

# Check .env exists (setup.sh creates it in project root)
if [ ! -f ".env" ]; then
    warn "No .env file found. Run ./scripts/setup.sh first, or:"
    warn "  cp .env.example .env"
    warn "  Edit .env with your GITHUB_TOKEN and ANTHROPIC_API_KEY"
    exit 1
fi

# Build worker image first (needed for orchestrator to spawn workers)
info "Building worker Docker image..."
docker build -t whim-worker -f packages/worker/Dockerfile . -q
success "Worker image built"

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Orchestrator:  http://localhost:${ORCHESTRATOR_PORT}${NC}"
echo -e "${GREEN}  PostgreSQL:    localhost:${POSTGRES_PORT}${NC}"
echo -e "${GREEN}  Redis:         localhost:${REDIS_PORT}${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

cd docker

if [ "$MODE" == "watch" ]; then
    info "Starting with hot-reload (docker compose watch)..."
    info "Code changes will auto-sync. Ctrl+C to stop."
    echo ""

    # Start with watch mode for hot-reload
    docker compose -f docker-compose.yml -f docker-compose.dev.yml watch
else
    info "Starting services..."
    docker compose -f docker-compose.yml up --build
fi
