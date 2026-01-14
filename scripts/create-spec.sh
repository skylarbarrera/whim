#!/usr/bin/env bash

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
  echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
  echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
  echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

# Check if Claude CLI is installed
check_claude_cli() {
  if ! command -v claude &> /dev/null; then
    log_error "Claude CLI not found"
    echo ""
    echo "Please install Claude Code CLI first:"
    echo "  npm install -g @anthropic-ai/claude-code"
    echo ""
    echo "Or visit: https://github.com/anthropics/claude-code"
    exit 1
  fi

  log_success "Claude CLI found: $(command -v claude)"
}

# Check if we're in a git repository
check_git_repo() {
  if ! git rev-parse --git-dir > /dev/null 2>&1; then
    log_error "Not in a git repository"
    echo ""
    echo "Please run this script from within your project's git repository."
    echo "If you haven't initialized git yet, run: git init"
    exit 1
  fi

  local repo_root
  repo_root=$(git rev-parse --show-toplevel)
  log_success "Git repository detected: $repo_root"
}

# Check for ANTHROPIC_API_KEY
check_api_key() {
  if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
    log_error "ANTHROPIC_API_KEY environment variable not set"
    echo ""
    echo "Please set your Anthropic API key:"
    echo "  export ANTHROPIC_API_KEY=sk-ant-..."
    echo ""
    echo "Get your API key from: https://console.anthropic.com/"
    exit 1
  fi

  log_success "ANTHROPIC_API_KEY is set"
}

# Show usage
show_usage() {
  cat << EOF
${BLUE}Interactive Spec Creation${NC}

This script helps you create a specification (SPEC.md) for your project
using Claude's interactive interview process.

${YELLOW}Usage:${NC}
  $0 [OPTIONS]

${YELLOW}Options:${NC}
  -o, --output PATH    Output path for SPEC.md (default: ./SPEC.md)
  -h, --help          Show this help message

${YELLOW}Prerequisites:${NC}
  - Claude Code CLI installed (npm install -g @anthropic-ai/claude-code)
  - ANTHROPIC_API_KEY environment variable set
  - Running from within a git repository

${YELLOW}Example:${NC}
  # Create spec in current directory
  $0

  # Create spec in specific location
  $0 --output /path/to/SPEC.md

${YELLOW}After creating your spec:${NC}
  1. Review and edit SPEC.md as needed
  2. Submit to Whim:
     See README.md for submission examples

EOF
}

# Parse command line arguments
OUTPUT_PATH="./SPEC.md"

while [[ $# -gt 0 ]]; do
  case $1 in
    -o|--output)
      OUTPUT_PATH="$2"
      shift 2
      ;;
    -h|--help)
      show_usage
      exit 0
      ;;
    *)
      log_error "Unknown option: $1"
      echo ""
      show_usage
      exit 1
      ;;
  esac
done

# Main execution
main() {
  log_info "Starting interactive spec creation..."
  echo ""

  # Run prerequisite checks
  log_info "Checking prerequisites..."
  check_claude_cli
  check_git_repo
  check_api_key
  echo ""

  # Check if SPEC.md already exists
  if [ -f "$OUTPUT_PATH" ]; then
    log_warning "SPEC.md already exists at: $OUTPUT_PATH"
    read -p "Do you want to overwrite it? (y/N): " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      log_info "Cancelled by user"
      exit 0
    fi
  fi

  log_info "Starting Claude CLI with /create-spec skill..."
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""

  # Run Claude CLI with /create-spec skill
  # The skill will guide the user through an interactive interview
  if claude /create-spec; then
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    # Check if SPEC.md was created
    if [ -f "SPEC.md" ]; then
      # Move to desired location if different
      if [ "$OUTPUT_PATH" != "./SPEC.md" ]; then
        mv SPEC.md "$OUTPUT_PATH"
      fi

      log_success "Spec created successfully: $OUTPUT_PATH"
      echo ""

      # Show next steps
      log_info "Next steps:"
      echo "  1. Review your spec: cat $OUTPUT_PATH"
      echo "  2. Edit if needed: \$EDITOR $OUTPUT_PATH"
      echo "  3. Submit to Whim (see --help for example)"
      echo ""
    else
      log_error "SPEC.md was not created"
      echo ""
      echo "The /create-spec skill may have been cancelled or failed."
      echo "Please try again or check the Claude CLI output above."
      exit 1
    fi
  else
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    log_error "Claude CLI exited with an error"
    exit 1
  fi
}

# Run main function
main
