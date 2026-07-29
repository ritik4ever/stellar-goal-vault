# PR: Add Campaign Analytics Dashboard for Creators

> **Closes #590**

---

## Summary

Adds a dedicated analytics dashboard at `/campaigns/:id/analytics` that gives campaign creators deep visibility into pledge velocity, contributor activity, funding pace, and top contributors. Includes a new backend analytics endpoint, full OpenAPI documentation, and a polished recharts-powered frontend with creator-only access gating.

---

## What's Included

### Backend (`backend/`)

| File | Change |
|------|--------|
| `src/services/campaignStore.ts` | Added `CampaignAnalytics` interface and `getCampaignAnalytics()` function |
| `src/index.ts` | Added `GET /api/campaigns/:id/analytics` endpoint |
| `src/openapi.ts` | Added full OpenAPI 3.1 schema and path registration for analytics |

**`getCampaignAnalytics()` computes:**
- **Pledge Velocity** — Daily pledge amounts and counts, grouped by day from the `pledges` table (`date(created_at, 'unixepoch')`)
- **Contributor Map** — Unique contributor count per day (`COUNT(DISTINCT contributor)`)
- **Funding Pace** — Cumulative percentage of target reached over time (calculated incrementally from velocity rows)
- **Top Contributors** — Top 10 contributors by total pledged amount (reuses `getContributorSummary`)

**Edge cases handled:**
- Campaigns with zero pledges → all arrays empty, `totalContributors` = 0
- Campaigns with pledges but all on one day → single data point in charts
- Target amount of 0 (division safety) → `calculateProgress` already handles this with `Math.min(100, ...)`

**API Response shape:**
```json
{
  "data": {
    "campaignId": "1",
    "creator": "G...",
    "title": "Clean Water Initiative",
    "targetAmount": 1000,
    "pledgedAmount": 455,
    "percentFunded": 45.5,
    "totalPledges": 12,
    "totalContributors": 5,
    "pledgeVelocity": [{ "date": "2024-01-15", "amount": 150, "count": 3 }],
    "contributorMap": [{ "date": "2024-01-15", "count": 2 }],
    "fundingPace": [{ "date": "2024-01-15", "cumulativePercent": 45.5 }],
    "topContributors": [{ "contributor": "G...", "totalPledged": 200 }]
  }
}
```

---

### Frontend (`frontend/`)

| File | Change |
|------|--------|
| `src/types/campaign.ts` | Added `CampaignAnalytics` TypeScript interface |
| `src/services/api.ts` | Added `getCampaignAnalytics()` API function |
| `src/components/CampaignAnalytics.tsx` | **New** — Full analytics page component (~300 lines) |
| `src/main.tsx` | Added `/campaigns/:id/analytics` route |
| `src/components/CampaignDetailPanel.tsx` | Added "View Campaign Analytics" link (creator-only) |
| `src/index.css` | Added ~300 lines of analytics page styles |

**CampaignAnalytics Page Features:**

- **Creator-Only Gating**: Uses `useFreighter` hook to get the connected wallet address and compares against `analytics.creator`. Non-creators see an access-restricted view with a `ShieldAlert` icon and instructions to connect their wallet.
- **4 Summary Stat Cards**: Funding Progress (%), Total Pledges, Unique Contributors, Daily Average Velocity — each with icon, label, value, and hover animation.
- **3 Recharts Panels:**
  - *Pledge Velocity* — Line chart of daily pledge amounts (`<LineChart>` with `#6366f1` stroke)
  - *Contributor Activity* — Bar chart of unique contributors per day (`<BarChart>` with `#a855f7` bars, rounded corners)
  - *Funding Pace* — Line chart of cumulative funding % over time (`<LineChart>` with `#22c55e` stroke, Y-axis 0–100%)
- **Top Contributors List** — Ranked table of top 10 with address avatar, truncated address, and total pledged amount
- **Theme-Aware ChartTooltip** — Custom recharts tooltip component using CSS variables for dark/light mode compatibility
- **Empty States** — Each chart panel shows an icon + descriptive message when no data exists (e.g., "No pledges yet. Pledge velocity will appear here once contributions begin.")
- **Loading State** — Skeleton cards and chart placeholder
- **Error State** — Error message with retry button (state-based, not `window.location.reload()`)
- **ErrorBoundary** — Wrapped in `<ErrorBoundary componentName="CampaignAnalytics">` for crash resilience
- **Mobile Responsive** — CSS grid collapses to single column at 919px, stat cards stack at 480px
- **Back Navigation** — `<ArrowLeft>` button returns to campaign detail page

**CampaignDetailPanel Link:**
- "View Campaign Analytics" link with `BarChart3` icon from lucide-react
- Only visible when `connectedWallet === activeCampaign.creator`
- Links to `/campaigns/:id/analytics`

---

## Acceptance Criteria

| Criteria | Status |
|----------|--------|
| Only campaign creator can access | ✅ Frontend gated via `useFreighter` wallet matching `analytics.creator`. Access-restricted view shown to non-creators. |
| Charts render for campaigns with < 5 pledges | ✅ Empty state messages and single-data-point fallback for funding pace |
| Mobile responsive | ✅ Responsive grid (2-col → 1-col at 919px, stat cards stack at 480px) |
| Route: `/campaigns/:id/analytics` | ✅ Added in `main.tsx` |
| Panels: pledge velocity, contributor map, funding pace, top contributors | ✅ All four panels implemented |
| Fetches from `/api/campaigns/:id/analytics` | ✅ Backend endpoint + frontend API function |

---

## How to Test

### Backend
```bash
cd backend
npm install
npm run dev  # or: npx ts-node src/index.ts

# Create a campaign
curl -X POST http://localhost:PORT/api/campaigns \
  -H "Content-Type: application/json" \
  -d '{"creator":"GAAAA...","title":"Test","description":"Test campaign for analytics","acceptedTokens":["USDC"],"targetAmount":100,"deadline":'$(date -d "+7 days" +%s)'}'

# Add some pledges
curl -X POST http://localhost:PORT/api/campaigns/1/pledges \
  -H "Content-Type: application/json" \
  -d '{"contributor":"GBBBB...","amount":25,"assetCode":"USDC"}'

# Fetch analytics
curl http://localhost:PORT/api/campaigns/1/analytics
```

### Frontend
```bash
cd frontend
npm install
npm run dev

# Navigate to http://localhost:5173/campaigns/1/analytics
# Connect Freighter wallet as the campaign creator
# Verify all four panels render with chart data
```

### Type Checks
```bash
cd backend && npx tsc --noEmit   # ✅ Clean (pre-existing cache.ts/schemas.ts errors only)
cd frontend && npx tsc --noEmit  # ✅ Clean (pre-existing CampaignDetailPanel.test.tsx errors only)
```

---

## Screenshots / Demo Notes

The analytics page features:
- Glass-morphism card design matching the existing theme
- Gradient hero title with the campaign name
- Color-coded stat cards with hover lift animations
- Smooth fade-in animations on all panels
- Dark/light mode support via CSS variables in chart components
- Stellar address avatars and copy buttons for contributor addresses

---

## Files Changed

```
 backend/src/index.ts                            |  15 +
 backend/src/openapi.ts                          |  60 +
 backend/src/services/campaignStore.ts           | 115 +
 frontend/src/components/CampaignAnalytics.tsx   | 330 + (new)
 frontend/src/components/CampaignDetailPanel.tsx |  12 +-
 frontend/src/index.css                          | 303 +
 frontend/src/main.tsx                           |   2 +
 frontend/src/services/api.ts                    |   9 +
 frontend/src/types/campaign.ts                  |  15 +
 ─────────────────────────────────────────────────────
 10 files changed, ~860 insertions, 1 deletion
```

---

## Notes
- The `package-lock.json` changes are from `npm install` and should be included/ignored based on repo convention
- Backend has pre-existing TS errors in `cache.ts` and `schemas.ts` unrelated to this PR
- Frontend has a pre-existing TS error in `CampaignDetailPanel.test.tsx` unrelated to this PR
- Future enhancement: add backend authorization (403 for non-creator) in addition to the frontend gate
