# Task 2: Implement Interactive Spec Creation Flow

## Goal
Implement a user interface for spec creation through guided questioning, allowing users to manually create specifications through an interactive process.

## Current State
- Ralph v0.3.0 already includes `/create-spec` skill for interactive spec creation
- This skill uses LLM-powered interview and review process
- Skill is available in Claude Code CLI
- Documentation exists in Ralph repository
- No integration with factory system yet

## Implementation Approach

### Option 1: Expose Ralph's /create-spec skill via API
- Add new API endpoint to orchestrator: POST /api/spec/interactive
- Endpoint spawns a Claude Code session with /create-spec skill
- Captures Q&A interaction and returns generated spec
- Challenges: Complex to stream Q&A through HTTP API

### Option 2: CLI-based interactive workflow (RECOMMENDED)
- Document how users can run `/create-spec` skill locally
- User runs `claude` CLI with `/create-spec` in their repo
- Generated SPEC.md can be submitted to factory via existing API
- Simpler, leverages existing Ralph tooling
- No factory code changes needed

### Option 3: Wrapper script for local usage
- Create `scripts/create-spec.sh` wrapper
- Script runs Claude CLI with appropriate settings
- Guides user through the interview process
- Outputs SPEC.md that can be submitted to factory
- Provides better UX than raw CLI

## Recommendation: Option 3 (Wrapper Script)

This approach:
- Leverages Ralph's existing `/create-spec` skill
- Provides simple UX without complex API streaming
- Works with local repos before submission to factory
- Maintains separation between spec creation and execution
- Easy to document and use

## Implementation Plan

### 1. Create wrapper script
- `scripts/create-spec.sh` - Bash script for interactive spec creation
- Checks prerequisites (Claude CLI installed)
- Validates repo context
- Runs Claude CLI with /create-spec skill
- Saves SPEC.md to specified location

### 2. Add configuration
- `.env.example` - Add any needed config vars
- Document ANTHROPIC_API_KEY requirement

### 3. Update documentation
- README.md - Add section on interactive spec creation
- Document the workflow: create spec → submit to factory
- Add examples and screenshots if possible

### 4. Test the workflow
- Run the script manually
- Verify SPEC.md generation
- Ensure it works with factory submission

## Files to Create/Modify
- `scripts/create-spec.sh` (NEW) - Interactive spec creation wrapper
- `README.md` - Document interactive workflow
- `.env.example` - Add ANTHROPIC_API_KEY if not present

## Exit Criteria
- [ ] Wrapper script created and executable
- [ ] Script checks prerequisites and provides helpful errors
- [ ] Documentation explains interactive workflow
- [ ] Users can create specs interactively and submit to factory
- [ ] Integration with existing factory submission API confirmed
