# Iteration 2 Plan: GitHub Action for Manual Retrigger

## Goal
Create a GitHub Actions workflow that allows manual retriggering of AI reviews for existing PRs.

## Task
- [ ] Manual retrigger works via GitHub Actions workflow dispatch (SPEC.md line 249)

## Implementation Steps

1. **Create workflow file** `.github/workflows/ai-review.yml`
   - Trigger: workflow_dispatch with branch input parameter
   - Checkout PR branch
   - Generate diff vs main
   - Read SPEC.md
   - Call review function
   - Post comment to PR

2. **Test the workflow**
   - Verify workflow file syntax
   - Ensure all required inputs are present
   - Check that required secrets are documented

## Files to Create
- `.github/workflows/ai-review.yml`

## Files to Modify
- `SPEC.md` - Mark line 20, 249 as complete
- `STATE.txt` - Update progress
- `.ai/ralph/index.md` - Document session

## Exit Criteria
- Workflow file exists and is valid YAML
- Workflow has proper inputs and steps
- All tests still pass
- Documentation updated
