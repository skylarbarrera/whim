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
RUN npm install -g bun && bun install

# =============================================================================
# Stage 2: Builder
# =============================================================================
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependencies (bun hoists to root node_modules)
COPY --from=deps /app/node_modules ./node_modules

# Copy source files
COPY package.json tsconfig.json ./
COPY packages/shared ./packages/shared
COPY packages/dashboard ./packages/dashboard

# Install bun and build shared package first
RUN npm install -g bun

WORKDIR /app/packages/shared
RUN bun run build

# Build dashboard
WORKDIR /app/packages/dashboard
ENV NEXT_TELEMETRY_DISABLED=1
# Set orchestrator URL for Next.js rewrites (baked at build time)
ENV ORCHESTRATOR_URL=http://orchestrator:3000
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

# Copy node_modules from deps (standalone doesn't work well in monorepos)
COPY --from=deps /app/node_modules ./node_modules

# Copy standalone output
COPY --from=builder /app/packages/dashboard/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/packages/dashboard/.next/standalone ./
# Static files must be at .next/static (not packages/dashboard/.next/static)
COPY --from=builder --chown=nextjs:nodejs /app/packages/dashboard/.next/static ./.next/static

USER nextjs

EXPOSE 3001

ENV PORT=3001
ENV HOSTNAME="0.0.0.0"
ENV ORCHESTRATOR_URL=http://orchestrator:3000

CMD ["node", "server.js"]
