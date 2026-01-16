# Whim Orchestrator Dockerfile
# Multi-stage build using Bun for consistency with monorepo

# =============================================================================
# Stage 1: Builder
# =============================================================================
FROM oven/bun:1 AS builder

# Install curl for health checks in dev mode (bun:1 is Debian-based)
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy root package files
COPY package.json bun.lock turbo.json tsconfig.json ./

# Copy workspace packages
COPY packages/shared ./packages/shared
COPY packages/orchestrator ./packages/orchestrator

# Install dependencies (use --no-save to avoid lockfile conflicts)
RUN bun install

# Build all packages (shared first, then orchestrator)
RUN bun run build

# =============================================================================
# Stage 2: Production
# =============================================================================
FROM oven/bun:1-slim

WORKDIR /app

# Install curl for health checks (bun-slim is Debian-based)
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# Create non-root user for running Claude Code (required for --dangerously-skip-permissions)
RUN groupadd -r whim && useradd -r -g whim -m whim

# Install Ralphie CLI and Claude Code globally
RUN bun install -g ralphie @anthropic-ai/claude-code && \
    chmod -R 755 /root && \
    chmod 755 /usr/local/bin/ralphie /usr/local/bin/claude

# Copy package files and lockfile from builder (lockfile may have been updated)
COPY --from=builder /app/package.json /app/bun.lock ./
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/orchestrator/package.json ./packages/orchestrator/

# Copy built artifacts
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/orchestrator/dist ./packages/orchestrator/dist

# Install production dependencies only
RUN bun install --production

# Set proper ownership for the app and create writable temp dir for spec generation
RUN chown -R whim:whim /app && mkdir -p /tmp/spec && chown whim:whim /tmp/spec

# Set working directory to orchestrator package
WORKDIR /app/packages/orchestrator

# Switch to non-root user
USER whim

# Environment variables with defaults
ENV PORT=3000
ENV LOOP_INTERVAL_MS=5000
ENV DATABASE_URL=postgres://whim:whim@postgres:5432/whim
ENV REDIS_URL=redis://redis:6379

# Expose the API port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Run the orchestrator
CMD ["bun", "dist/index.js"]
