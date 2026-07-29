## Overview

This PR addresses two issues: adds comprehensive campaign lifecycle state machine documentation with a Mermaid state diagram, and implements a minimal campaign embed widget (iframe) for cross-origin embedding.

## Related Issues

Closes #599
Closes #661

## Changes

### Campaign Lifecycle Documentation

- **[UPDATE]** `CAMPAIGN_LIFECYCLE_IMPLEMENTATION.md`
  - Added Mermaid `stateDiagram-v2` with all transitions: `[*] -> open -> funded -> claimed -> [*]` and `open -> failed -> [*]`
  - Documented all 4 states (open, funded, claimed, failed) with descriptions
  - Added guard conditions for each transition with API endpoint references
  - Added complete API cross-reference table showing endpoint to state effects
  - Added contract events table (created, pledged, claimed, refunded) with metadata

### Campaign Embed Widget

- **[ADD]** `frontend/src/components/EmbedWidget.tsx`
  - Route: `/embed/campaigns/:id` renders minimal standalone widget
  - Shows: title, progress bar, pledged/target amounts, deadline countdown, "Back this campaign" button
  - Responsive at 300x200 (compact) and 600x300 (wide) -- auto-detects from container width
  - No navigation, sidebars, or auth required for public campaigns
  - Cross-origin compatible with `target="_top"` links and CSP compatibility

- **[MODIFY]** `frontend/src/main.tsx` -- registered `/embed/campaigns/:id` route

- **[MODIFY]** `frontend/src/index.css` -- added embed widget styles (glassmorphism, progress bar, skeleton loader, error state)

## Acceptance Criteria

| Criterion | Status |
| --- | --- |
| Mermaid state diagram renders on GitHub | Included in CAMPAIGN_LIFECYCLE_IMPLEMENTATION.md |
| All states and transitions documented | 4 states, 3 transitions, guard conditions documented |
| API endpoint cross-reference complete | 9 endpoints listed with state effects |
| Widget works in cross-origin iframe | target=_top, no auth, CSP compatible |
| Widget responsive at 300x200 and 600x300 | Auto-detects from container width, compact/wide layouts |
| No auth required for public campaigns | Public API call via getCampaign() |
