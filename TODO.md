# Backend Search (?search=) Parameter - Implementation TODO

## Approved Plan Summary

Add `?search=` query param to GET /api/campaigns filtering titles case-insensitively via SQL LIKE. Map to existing `searchQuery` logic (keep ?q= compat). Restrict to title only. Frontend: integrate server search, remove client-side filtering.

## Implementation Steps (Complete in order)

### 1. Create TODO.md and Backend Schema Prep

- [x] Created TODO.md with steps

### 2. Backend: Update parseCampaignListFilters in index.ts

- Add `search?: unknown` param to parseCampaignListFilters, prefer searchQuery = normalizeQueryValue(query.search) || query.q
- Pass search: req.query.search in /api/campaigns call
- [x] Edit backend/src/index.ts

### 3. Backend: Restrict campaignStore.ts SQL to title only

- In listCampaigns if(searchQuery): whereClauses.push(`LOWER(title) LIKE ?`); params.push(searchTerm);
- [x] Edit backend/src/services/campaignStore.ts

### 4. Frontend: Update api.ts listCampaigns

- Accept `filters?: { search?: string; asset?: string; status?: string; includeDeleted?: boolean }`
- Add params.set('search', filters.search?.trim()); + asset/status
- [x] Edit frontend/src/services/api.ts

### 5. Frontend: Integrate SearchInput → CampaignsTable server fetch

- Add onSearchChange prop to table, useEffect(debouncedSearchQuery => onSearchChange)
- App.tsx: onSearchChange={(query) => refreshCampaigns(query)}, update refreshCampaigns(searchQuery:string='')
- Remove debouncedSearchQuery from filteredCampaigns useMemo deps, pass '' to applyFilters
- Update bootstrap listCampaigns({search:''})
- [x] Edit frontend/src/components/CampaignsTable.tsx
- [x] Edit frontend/src/App.tsx

### 6. Frontend: Clean up utils

- Remove searchCampaigns call from applyFilters, comment server-side search
- [ ] Edit frontend/src/components/campaignsTableUtils.ts

### 7. Testing & Follow-up

- Backend: Restart, test `curl http://localhost:3001/api/campaigns?search=title`
- Frontend: `npm run dev`, test search input → server filter, case-insens, empty=all
- Verify progress fields unchanged
- E2E test if exists
- [ ] Update TODO.md on complete
- [ ] attempt_completion

## Progress

Ready for step-by-step implementation.
