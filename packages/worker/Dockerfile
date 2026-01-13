# Factory Worker Dockerfile
# Runs Claude Code autonomously to complete tasks from SPEC.md

FROM oven/bun:1-debian AS builder

WORKDIR /app

# Copy package files for dependency resolution
COPY package.json bun.lockb ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/worker/package.json ./packages/worker/

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code
COPY packages/shared ./packages/shared
COPY packages/worker ./packages/worker
COPY tsconfig.json ./

# Build shared and worker packages
WORKDIR /app/packages/shared
RUN bun run build

WORKDIR /app/packages/worker
RUN bun run build

# ============================================
# Runtime stage
# ============================================
FROM debian:bookworm-slim

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    curl \
    git \
    gnupg \
    ca-certificates \
    nodejs \
    npm \
    && rm -rf /var/lib/apt/lists/*

# Install GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update \
    && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Install Bun for runtime
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

# Create workspace directory
RUN mkdir -p /workspace

# Set working directory
WORKDIR /app

# Copy built worker from builder stage
COPY --from=builder /app/packages/worker/dist ./dist
COPY --from=builder /app/packages/worker/package.json ./
COPY --from=builder /app/packages/shared/dist ./node_modules/@factory/shared/dist
COPY --from=builder /app/packages/shared/package.json ./node_modules/@factory/shared/

# Copy Claude configuration
COPY packages/worker/.claude /root/.claude

# Set environment defaults
ENV WORK_DIR=/workspace
ENV NODE_ENV=production

# Entry point runs the worker
CMD ["node", "dist/index.js"]
