# Build stage
FROM oven/bun:1 AS builder

WORKDIR /app

# Copy root package files
COPY package.json bun.lock* tsconfig.json ./

# Copy packages
COPY packages/shared ./packages/shared
COPY packages/review-system ./packages/review-system
COPY packages/review-dashboard ./packages/review-dashboard

# Install dependencies
RUN cd packages/shared && bun install
RUN cd packages/review-system && bun install
RUN cd packages/review-dashboard && bun install

# Build shared and review-system first
RUN cd packages/shared && bun run build
RUN cd packages/review-system && bun run build

# Build dashboard
RUN cd packages/review-dashboard && bun run build

# Runtime stage
FROM node:20-slim AS runtime

WORKDIR /app

# Copy built application
COPY --from=builder /app/packages/review-dashboard/.next/standalone ./
COPY --from=builder /app/packages/review-dashboard/.next/static ./packages/review-dashboard/.next/static
COPY --from=builder /app/packages/review-dashboard/public ./packages/review-dashboard/public

# Set environment
ENV NODE_ENV=production
ENV PORT=3001
ENV HOSTNAME=0.0.0.0

EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

CMD ["node", "packages/review-dashboard/server.js"]
