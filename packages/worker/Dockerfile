# Whim Worker Dockerfile
# Runs Claude Code autonomously to complete tasks from SPEC.md

FROM oven/bun:1-debian AS builder

WORKDIR /app

# Copy package files for dependency resolution
COPY package.json bun.lock ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/harness/package.json ./packages/harness/
COPY packages/worker/package.json ./packages/worker/

# Install dependencies
RUN bun install

# Copy source code
COPY packages/shared ./packages/shared
COPY packages/harness ./packages/harness
COPY packages/worker ./packages/worker
COPY tsconfig.json ./

# Build shared, harness, and worker packages
WORKDIR /app/packages/shared
RUN bun run build

WORKDIR /app/packages/harness
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
    unzip \
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

# Install Ralphie from npm (v1.1 for V2 spec format support)
RUN npm install -g ralphie@^1.1.0

# Create non-root user for security (Claude blocks --dangerously-skip-permissions for root)
RUN useradd -m -s /bin/bash worker
RUN mkdir -p /workspace && chown worker:worker /workspace

# Set working directory
WORKDIR /app

# Copy built worker from builder stage
COPY --from=builder /app/packages/worker/dist ./dist
COPY --from=builder /app/packages/worker/package.json ./

# Copy all node_modules from builder (includes @anthropic-ai/sdk and transitive deps)
COPY --from=builder /app/node_modules ./node_modules

# Copy shared package (overwrite workspace link with actual build)
COPY --from=builder /app/packages/shared/dist ./node_modules/@whim/shared/dist
COPY --from=builder /app/packages/shared/package.json ./node_modules/@whim/shared/

# Copy harness package
COPY --from=builder /app/packages/harness/dist ./node_modules/@whim/harness/dist
COPY --from=builder /app/packages/harness/package.json ./node_modules/@whim/harness/

# Copy Claude configuration to worker user's home
COPY --chown=worker:worker packages/worker/.claude /home/worker/.claude

# Create required Claude directories
RUN mkdir -p /home/worker/.claude/todos /home/worker/.claude/debug

# Set ownership of app directory and Claude config
RUN chown -R worker:worker /app /home/worker/.claude

# Switch to non-root user
USER worker

# Set environment defaults
ENV WORK_DIR=/workspace
ENV NODE_ENV=production
ENV HOME=/home/worker

# Entry point runs the worker
CMD ["node", "dist/index.js"]
