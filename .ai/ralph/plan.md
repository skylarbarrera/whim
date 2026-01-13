# Plan: Implement AI PR Detection Mechanism

## Goal
Implement a system to detect and tag AI-generated PRs with metadata that includes generation context and prompts for reviewers.

## Sub-tasks from SPEC.md
- Add metadata tagging for AI-generated PRs
- Create PR classification logic
- Store AI generation context/prompts for reviewers

## Files to Create/Modify

### New Files
1. `packages/review-system/src/detection/ai-detector.ts`
   - AIDetector class
   - Detection heuristics (commit patterns, PR description markers)
   - Confidence scoring

2. `packages/review-system/src/detection/pr-tagger.ts`
   - PRTagger class
   - GitHub labels management
   - PR metadata storage (comments, labels, custom fields)

3. `packages/review-system/src/detection/context-store.ts`
   - ContextStore class
   - Store AI generation context (prompts, model info)
   - Retrieve context for reviewers

4. `packages/review-system/src/__tests__/ai-detector.test.ts`
   - Test detection heuristics
   - Test confidence scoring

5. `packages/review-system/src/__tests__/pr-tagger.test.ts`
   - Test label management
   - Test metadata storage

6. `packages/review-system/src/__tests__/context-store.test.ts`
   - Test context storage and retrieval

### Export Files
7. `packages/review-system/src/detection/index.ts` - Export detection module
8. `packages/review-system/src/index.ts` - Add detection exports

## Implementation Details

### AIDetector
- Check for AI markers in commit messages (co-authored by Claude, Ralph events)
- Check PR description for AI generation indicators
- Check for [RALPH:*] events in commit messages
- Check for factory worker metadata
- Return confidence score (0-100)

### PRTagger
- Add/remove GitHub labels (ai-generated, needs-review, etc.)
- Store metadata as PR comments (hidden or visible)
- Support custom GitHub PR fields if available

### ContextStore
- Store generation context in PR body or comments
- Include: prompts, model version, iteration count, token usage
- Format for reviewer visibility
- Support retrieval by PR number

## Tests
- Test detection with factory-generated PRs (high confidence)
- Test detection with Claude co-authorship (medium confidence)
- Test detection with manual PRs (low confidence)
- Test label addition/removal
- Test context storage and retrieval
- Test metadata formatting

## Exit Criteria
- [ ] AIDetector class implemented with confidence scoring
- [ ] PRTagger class implemented with label and metadata management
- [ ] ContextStore class implemented for context storage/retrieval
- [ ] All tests passing (expect 30+ tests)
- [ ] Types exported from package
- [ ] Documentation in JSDoc format
