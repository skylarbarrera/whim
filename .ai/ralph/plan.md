# Ralph Iteration Plan

## Goal
Build a review dashboard/UI for visualizing review step status, showing failed check details with remediation guidance, and providing a manual review trigger interface.

## Files to Create/Modify

**New Package:**
1. `packages/review-dashboard/package.json` - Package config
2. `packages/review-dashboard/tsconfig.json` - TypeScript config
3. `packages/review-dashboard/next.config.js` - Next.js config
4. `packages/review-dashboard/Dockerfile` - Container build

**Pages:**
5. `packages/review-dashboard/app/layout.tsx` - Root layout
6. `packages/review-dashboard/app/page.tsx` - Review list/overview
7. `packages/review-dashboard/app/reviews/[id]/page.tsx` - Review details
8. `packages/review-dashboard/app/trigger/page.tsx` - Manual trigger

**Components:**
9. `packages/review-dashboard/components/ReviewStepStatus.tsx` - Status badges
10. `packages/review-dashboard/components/ReviewTimeline.tsx` - Step timeline
11. `packages/review-dashboard/components/ReviewMessages.tsx` - Error/warning display
12. `packages/review-dashboard/components/FileAnnotations.tsx` - File-level issues
13. `packages/review-dashboard/components/TriggerForm.tsx` - Manual trigger form

**Library:**
14. `packages/review-dashboard/lib/api.ts` - API client

**Tests:**
15. `packages/review-dashboard/components/__tests__/ReviewStepStatus.test.tsx`
16. `packages/review-dashboard/components/__tests__/ReviewTimeline.test.tsx`
17. `packages/review-dashboard/lib/__tests__/api.test.ts`

**Updates:**
18. `docker/docker-compose.yml` - Add review-dashboard service

## Implementation Plan

### 1. Create Dashboard Package
- Set up Next.js 14+ with App Router
- Configure TypeScript with strict mode
- Add dependencies: react, next, @factory/review-system, @factory/shared
- Create basic layout and navigation

### 2. Build Review Visualization Components
- ReviewStepStatus: Color-coded status badges (pass=green, fail=red, error=orange, pending=blue, skipped=gray)
- ReviewTimeline: Visual timeline showing step execution order (sequential/parallel)
- ReviewMessages: Grouped by severity (errors, warnings, info) with file/line links
- FileAnnotations: Group issues by file with syntax highlighting

### 3. Review List Page (/)
- Table of recent reviews with PR info, status, timestamp
- Filter by status, repository, AI-generated flag
- Click to view details

### 4. Review Details Page (/reviews/[id])
- Overall status and summary
- ReviewTimeline showing all steps
- ReviewMessages grouped by severity and file
- Detailed metadata (duration, PR info, AI context)
- Remediation guidance for failures

### 5. Manual Trigger Page (/trigger)
- Form to select PR (owner/repo/number)
- Workflow dropdown (from config)
- Configuration overrides (optional)
- Trigger button
- Real-time status updates
- Result display

### 6. API Client (lib/api.ts)
- fetchReviews() - Get list of reviews
- fetchReviewById() - Get single review
- triggerReview() - Start manual review
- getReviewStatus() - Poll for status updates

### 7. Docker Integration
- Dockerfile with Next.js standalone build
- Add service to docker-compose.yml
- Configure API proxy to review-system

### 8. Testing
- Component tests with React Testing Library
- API client tests with mocked fetch
- Integration tests for pages

## Exit Criteria
- ✅ Dashboard displays review results with status visualization
- ✅ Failed checks show detailed error information with fix suggestions
- ✅ Manual trigger interface can initiate reviews
- ✅ Real-time status updates during review execution
- ✅ All components have tests
- ✅ Package builds successfully
- ✅ TypeScript type checks pass
- ✅ Docker image builds and runs

## Notes
- Reuse patterns from existing @factory/dashboard package
- Use @factory/review-system types directly
- Consider Server-Sent Events (SSE) for real-time updates
- Store review results in memory or database for historical tracking
- Keep UI simple and functional (no fancy animations)
