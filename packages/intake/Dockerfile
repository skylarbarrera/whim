# Whim Intake Service Dockerfile
# Multi-stage build using Bun for consistency with monorepo

# =============================================================================
# Stage 1: Builder
# =============================================================================
FROM oven/bun:1 AS builder

WORKDIR /app

# Copy root package files
COPY package.json bun.lock turbo.json tsconfig.json ./

# Copy workspace packages
COPY packages/shared ./packages/shared
COPY packages/intake ./packages/intake

# Install dependencies
RUN bun install

# Build all packages (shared first, then intake)
RUN bun run build

# =============================================================================
# Stage 2: Production
# =============================================================================
FROM oven/bun:1-slim

WORKDIR /app

# Copy package files and lockfile from builder (lockfile may have been updated)
COPY --from=builder /app/package.json /app/bun.lock ./
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/intake/package.json ./packages/intake/

# Copy built artifacts
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/intake/dist ./packages/intake/dist

# Install production dependencies only
RUN bun install --production

# Set working directory to intake package
WORKDIR /app/packages/intake

# Environment variables (no defaults for secrets)
ENV ORCHESTRATOR_URL=http://whim-orchestrator:3000
ENV INTAKE_LABEL=whim
ENV POLL_INTERVAL=60000

# Run the intake service
CMD ["bun", "dist/index.js"]
