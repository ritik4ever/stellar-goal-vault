# Soft Delete Support for Campaigns - Implementation TODO

## Approved Plan Summary

Add soft-delete flag (`deleted_at INTEGER`) to campaigns table. Exclude deleted from default lists. New API for soft-delete. Query param `includeDeleted=true` for maintainers. Preserve history/pledges.

## Implementation Steps (Complete in order)

### 1. Backend Database Schema Update (db.ts)

- Add `deleted_at INTEGER,` to campaigns table in migrate().
- [x] Edit backend/src/services/db.ts
- [x] Ran migration

### 2. Backend Types & campaignStore.ts Updates

- Add `deletedAt?: number` to CampaignRecord, CampaignRow.
- Update listCampaigns(options): Add `includeDeleted?: boolean` param, WHERE `deleted_at IS NULL OR includeDeleted`.
- Add `softDeleteCampaign(campaignId: string)`: UPDATE SET deleted_at = now() WHERE id=? AND deleted_at IS NULL.
- Update rowToCampaign() mapper.
- [x] Edit backend/src/services/campaignStore.ts

### 3. Backend API Routes (index.ts)

- parseCampaignListFilters(): Add `includeDeleted: req.query.includeDeleted === 'true'`.
- GET /api/campaigns: Pass includeDeleted to listCampaigns.
- Add POST /api/campaigns/:id/soft-delete: Auth? Call softDeleteCampaign.
- [x] Edit backend/src/index.ts

### 4. Frontend Types

- Add `isDeleted?: boolean` and `deletedAt?: number` to Campaign interface.
- [x] Edit frontend/src/types/campaign.ts

### 5. Frontend API Client
- listCampaigns(filters?: {includeDeleted?: boolean}): Pass param.
- Add softDeleteCampaign(campaignId): POST /campaigns/${id}/soft-delete.
- [x] Edit frontend/src/services/api.ts

### 6. Frontend UI Updates

- CampaignsTable.tsx: Add includeDeleted checkbox (admin), refresh on toggle.
- CampaignDetailPanel.tsx / CampaignsTable: Add soft-delete button (for creator/maintainer).
- Handle response: Refresh campaigns list.
- [x] Edit frontend/src/App.tsx (handler + import)
- [x] Edit frontend/src/components/CampaignDetailPanel.tsx

### 7. Testing & Follow-up

- [ ] Manual test: Create → soft-delete → list excludes → ?includeDeleted=true shows → history intact.
- [ ] Backend restart/migration: node backend/src/services/db initDb().
- [ ] Update tests if needed.
- [ ] attempt_completion

## Progress

Ready for step-by-step implementation.
