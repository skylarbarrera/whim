# Iteration 4 Plan: Create src/components/Section.tsx - boxed section with header

## Goal
Create a reusable Section component that displays a boxed section with a header. This will be used throughout the dashboard to organize content.

## Files to Create/Modify
- `packages/cli/src/components/Section.tsx` - Boxed section component with header

## Implementation Steps
1. Create components directory
2. Create Section.tsx component that:
   - Takes header (string) and children (React nodes) as props
   - Uses Ink's Box component for borders
   - Applies cyan color to section headers (per spec)
   - Has proper padding and layout
   - Is flexible to contain various child components

## Tests
- Verify the component follows Ink patterns
- Check that it exports properly
- Ensure TypeScript types are correct

## Exit Criteria
- [ ] `packages/cli/src/components/Section.tsx` exists
- [ ] Component renders a box with header
- [ ] Uses cyan color for headers per spec
- [ ] Accepts children prop for content
- [ ] TypeScript types are properly defined

## Notes
- This is Phase 1, Task 4 from SPEC.md
- Color scheme from spec: Section headers should be Cyan
- Will be reused throughout the dashboard
- Should use Ink's Box component for borders
