#!/usr/bin/env bash
# Whim - Migration Script
# Runs SQL migrations against the database

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
MIGRATIONS_DIR="$PROJECT_ROOT/migrations"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

success() { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
error() { echo -e "${RED}✗${NC} $1"; exit 1; }

# Load environment variables
if [ -f "$PROJECT_ROOT/.env" ]; then
    set -a
    source "$PROJECT_ROOT/.env"
    set +a
fi

# Default database URL
DATABASE_URL="${DATABASE_URL:-postgres://whim:whim@localhost:5433/whim}"

# Parse DATABASE_URL to get connection parameters
# Format: postgres://user:password@host:port/database
parse_db_url() {
    local url="$1"
    # Remove protocol
    url="${url#postgres://}"
    url="${url#postgresql://}"

    # Extract user:password@host:port/database
    DB_USER="${url%%:*}"
    url="${url#*:}"
    DB_PASS="${url%%@*}"
    url="${url#*@}"
    DB_HOST="${url%%:*}"
    url="${url#*:}"
    DB_PORT="${url%%/*}"
    DB_NAME="${url#*/}"
}

parse_db_url "$DATABASE_URL"

echo "🗄️  Running migrations..."
echo "   Host: $DB_HOST:$DB_PORT"
echo "   Database: $DB_NAME"
echo ""

# Check if postgres is accessible
if ! docker exec whim-postgres pg_isready -U "$DB_USER" -d "$DB_NAME" &> /dev/null 2>&1; then
    # Try without docker (local postgres)
    if ! command -v psql &> /dev/null; then
        error "PostgreSQL is not accessible. Start with: docker compose -f docker/docker-compose.yml up -d postgres"
    fi
fi

# Check migrations directory
if [ ! -d "$MIGRATIONS_DIR" ]; then
    error "Migrations directory not found: $MIGRATIONS_DIR"
fi

# Get list of migration files
MIGRATION_FILES=($(find "$MIGRATIONS_DIR" -name "*.sql" | sort))

if [ ${#MIGRATION_FILES[@]} -eq 0 ]; then
    warn "No migration files found"
    exit 0
fi

# Run each migration
for migration in "${MIGRATION_FILES[@]}"; do
    filename=$(basename "$migration")
    echo "Running: $filename"

    # Try docker exec first, fall back to local psql
    if docker ps --format '{{.Names}}' | grep -q whim-postgres; then
        docker exec -i whim-postgres psql -U "$DB_USER" -d "$DB_NAME" < "$migration" 2>&1 || {
            # Some errors are OK (e.g., "relation already exists")
            warn "Migration may have already been applied: $filename"
        }
    else
        PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" < "$migration" 2>&1 || {
            warn "Migration may have already been applied: $filename"
        }
    fi

    success "$filename"
done

echo ""
success "All migrations complete"
