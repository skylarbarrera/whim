#!/usr/bin/env bash
# Whim - Setup Script
# One-time setup: checks prerequisites, creates .env, installs deps, builds images, starts services, runs migrations

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

echo "🏭 Whim - Setup"
echo "==============================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

success() { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
error() { echo -e "${RED}✗${NC} $1"; exit 1; }

# 1. Check prerequisites
echo "Checking prerequisites..."

# Check Docker
if ! command -v docker &> /dev/null; then
    error "Docker is required but not installed. Please install Docker first."
fi
success "Docker found"

# Check Docker is running
if ! docker info &> /dev/null 2>&1; then
    error "Docker is not running. Please start Docker first."
fi
success "Docker is running"

# Check Bun
if ! command -v bun &> /dev/null; then
    error "Bun is required but not installed. Install with: curl -fsSL https://bun.sh/install | bash"
fi
success "Bun found"

# 2. Create .env if it doesn't exist
echo ""
echo "Checking environment..."

if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        cp .env.example .env
        warn "Created .env from .env.example - please edit with your values"
    else
        cat > .env << 'EOF'
# Whim - Environment Variables

# Required
GITHUB_TOKEN=           # GitHub PAT with repo permissions
REPOS=                  # Comma-separated: owner/repo1,owner/repo2

# Optional (with defaults)
DATABASE_URL=postgres://factory:factory@localhost:5432/factory
REDIS_URL=redis://localhost:6379
MAX_WORKERS=2           # Max concurrent workers
DAILY_BUDGET=200        # Max iterations per day
COOLDOWN_SECONDS=60     # Seconds between worker spawns
INTAKE_LABEL=whim # GitHub label to watch
POLL_INTERVAL=60000     # GitHub poll interval (ms)
EOF
        warn "Created .env - please edit with your values"
    fi
else
    success ".env already exists"
fi

# 3. Install dependencies
echo ""
echo "Installing dependencies..."

bun install
success "Dependencies installed"

# 4. Build packages
echo ""
echo "Building packages..."

bun run build
success "Packages built"

# 5. Build worker Docker image
echo ""
echo "Building worker Docker image..."

if [ -f "packages/worker/Dockerfile" ]; then
    docker build -t whim-worker -f packages/worker/Dockerfile .
    success "Worker image built"
else
    warn "Worker Dockerfile not found - skipping worker image build"
fi

# 6. Start postgres and redis
echo ""
echo "Starting postgres and redis..."

cd docker
docker compose up -d postgres redis
cd "$PROJECT_ROOT"

# Wait for services to be healthy
echo "Waiting for services to be ready..."
sleep 5

# Check postgres health
for i in {1..30}; do
    if docker exec whim-postgres pg_isready -U factory -d factory &> /dev/null; then
        success "PostgreSQL is ready"
        break
    fi
    if [ $i -eq 30 ]; then
        error "PostgreSQL failed to start"
    fi
    sleep 1
done

# Check redis health
for i in {1..10}; do
    if docker exec whim-redis redis-cli ping &> /dev/null; then
        success "Redis is ready"
        break
    fi
    if [ $i -eq 10 ]; then
        error "Redis failed to start"
    fi
    sleep 1
done

# 7. Run migrations
echo ""
echo "Running migrations..."

"$SCRIPT_DIR/migrate.sh"
success "Migrations complete"

# Done
echo ""
echo "==============================="
echo -e "${GREEN}🎉 Setup complete!${NC}"
echo ""
echo "Next steps:"
echo "  1. Edit .env with your GITHUB_TOKEN and REPOS"
echo "  2. Run: ./scripts/dev.sh"
echo ""
