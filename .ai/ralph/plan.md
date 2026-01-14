# Iteration 13 Plan: Cleanup - Remove old dashboard and update docs

## Goal
Complete the cleanup phase by removing the old Next.js dashboard and updating documentation to reflect the new CLI.

## Files to Create/Modify
- Delete `packages/dashboard/` directory
- Update `docker/docker-compose.yml` - remove dashboard service
- Update `README.md` - document CLI usage instead of web dashboard

## Implementation Steps
1. Delete packages/dashboard directory (old Next.js dashboard)
2. Update docker-compose.yml:
   - Remove dashboard service
   - Remove dashboard volume if any
   - Update any references
3. Update README.md:
   - Replace dashboard documentation with CLI usage
   - Add examples of `whim dashboard` and `whim status`
   - Document --api-url flag
   - Update architecture description

## Tests
- Verify files are deleted/updated
- Check that docker-compose is still valid YAML
- Ensure README is clear and accurate

## Exit Criteria
- [ ] packages/dashboard deleted
- [ ] docker-compose.yml updated
- [ ] README.md updated with CLI docs
- [ ] All Cleanup tasks marked complete

## Notes
- This is the Cleanup phase from SPEC.md
- CLI is now the primary interface
- Completes the migration from web to CLI dashboard
