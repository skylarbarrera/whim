#!/usr/bin/env bash
# AI Software Factory - Development Script
# Starts the development environment with all services

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

success() { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
error() { echo -e "${RED}✗${NC} $1"; exit 1; }
info() { echo -e "${BLUE}ℹ${NC} $1"; }

# Parse arguments
DASHBOARD=false
REBUILD=false
DETACH=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --dashboard|-d)
            DASHBOARD=true
            shift
            ;;
        --rebuild|-r)
            REBUILD=true
            shift
            ;;
        --detach|-D)
            DETACH=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  -d, --dashboard    Include dashboard service"
            echo "  -r, --rebuild      Rebuild all images"
            echo "  -D, --detach       Run in background (detached)"
            echo "  -h, --help         Show this help"
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
if [ ! -f ".env" ]; then
    warn "No .env file found. Run ./scripts/setup.sh first."
    exit 1
fi

# Load .env for display
source .env 2>/dev/null || true

# Build compose command
cd docker
COMPOSE_CMD="docker compose"

# Add profile for dashboard if requested
if [ "$DASHBOARD" = true ]; then
    COMPOSE_CMD="$COMPOSE_CMD --profile with-dashboard"
    info "Dashboard enabled"
fi

# Rebuild if requested
if [ "$REBUILD" = true ]; then
    info "Rebuilding images..."
    $COMPOSE_CMD build
    success "Images rebuilt"
fi

# Start services
echo ""
if [ "$DETACH" = true ]; then
    info "Starting services in background..."
    $COMPOSE_CMD up -d
else
    info "Starting services (Ctrl+C to stop)..."
    echo ""
fi

echo "Services:"
echo "  • PostgreSQL:   localhost:5432"
echo "  • Redis:        localhost:6379"
echo "  • Orchestrator: http://localhost:3002"
if [ "$DASHBOARD" = true ]; then
    echo "  • Dashboard:    http://localhost:3003"
fi
echo ""

if [ "$DETACH" = true ]; then
    $COMPOSE_CMD up -d
    echo ""
    success "Services started in background"
    echo ""
    echo "Useful commands:"
    echo "  docker compose -f docker/docker-compose.yml logs -f    # View logs"
    echo "  docker compose -f docker/docker-compose.yml ps         # Check status"
    echo "  docker compose -f docker/docker-compose.yml down       # Stop services"
else
    $COMPOSE_CMD up
fi
