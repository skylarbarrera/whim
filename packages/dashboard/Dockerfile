# Factory Dashboard Dockerfile
# Multi-stage build for Next.js standalone output

# =============================================================================
# Stage 1: Dependencies
# =============================================================================
FROM node:20-alpine AS deps

WORKDIR /app

# Copy root package files
COPY package.json bun.lock ./

# Copy workspace packages (need shared types)
COPY packages/shared/package.json ./packages/shared/
COPY packages/dashboard/package.json ./packages/dashboard/

# Install bun for dependency installation
RUN npm install -g bun && bun install --frozen-lockfile

# =============================================================================
# Stage 2: Builder
# =============================================================================
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependencies
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/packages/dashboard/node_modules ./packages/dashboard/node_modules

# Copy source files
COPY package.json ./
COPY packages/shared ./packages/shared
COPY packages/dashboard ./packages/dashboard

# Build shared package first
WORKDIR /app/packages/shared
RUN npm install -g bun && bun run build

# Build dashboard
WORKDIR /app/packages/dashboard
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# =============================================================================
# Stage 3: Production
# =============================================================================
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy standalone output
COPY --from=builder /app/packages/dashboard/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/packages/dashboard/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/packages/dashboard/.next/static ./packages/dashboard/.next/static

USER nextjs

EXPOSE 3001

ENV PORT=3001
ENV HOSTNAME="0.0.0.0"
ENV ORCHESTRATOR_URL=http://orchestrator:3000

CMD ["node", "packages/dashboard/server.js"]
