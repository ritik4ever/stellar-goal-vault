# Campaign Abuse Reporting

Implements [#565](https://github.com/ritik4ever/stellar-goal-vault/issues/565).

Any user can report a campaign for **fraud**, **spam**, or **duplicate** content.
Reports are stored in the `campaign_reports` table. Once a campaign accumulates
enough unresolved reports it is automatically flagged for admin review, and
admins triage the queue via the `/api/admin/reports` endpoints.

## Endpoints

### `POST /api/campaigns/:id/report`

Public. Files a report against a campaign.

| Field      | Required | Notes                                        |
| ---------- | -------- | -------------------------------------------- |
| `reporter` | yes      | 56-char Stellar address (`G…`)               |
| `reason`   | yes      | `fraud` \| `spam` \| `duplicate`             |
| `details`  | no       | free text, max 500 chars                     |

- `201` with the stored report plus flagging context:

  ```json
  {
    "data": {
      "report": {
        "id": 1,
        "campaignId": "12",
        "reporter": "GA...",
        "reason": "fraud",
        "details": "…",
        "status": "pending",
        "createdAt": 1735689600
      },
      "reportCount": 1,
      "autoFlagThreshold": 10,
      "autoFlagged": false,
      "flaggedForReview": false
    }
  }
  ```

- `400` invalid body (bad address, unknown reason, over-long details).
- `404` campaign not found (or archived).
- `409` (`DUPLICATE_REPORT`) the same reporter already reported this campaign.

### `GET /api/admin/reports`

Admin only. Lists reports for moderation, newest first.

| Query param  | Default   | Notes                                             |
| ------------ | --------- | ------------------------------------------------- |
| `status`     | `pending` | `pending` \| `dismissed` \| `actioned` \| `all`   |
| `campaignId` | –         | restrict to one campaign                          |
| `page`       | `1`       | 1-based                                           |
| `limit`      | `20`      | 1–100                                             |

Responds with `{ data: Report[], pagination: { total, page, limit, totalPages } }`
and an `X-Total-Count` header.

### `PATCH /api/admin/reports/:reportId`

Admin only. Resolves a single pending report.

```json
{
  "action": "dismiss | act (required)",
  "admin": "GA... optional Stellar address of the acting admin"
}
```

- `dismiss` → status `dismissed` (no wrongdoing; excluded from the auto-flag count).
- `act` → status `actioned` (campaign removed, creator warned, …).
- `404` unknown report, `409` (`REPORT_ALREADY_RESOLVED`) already dismissed/actioned.

## Auto-flagging

- A campaign is flagged (`campaigns.flagged_for_review = 1`, `campaigns.flagged_at`
  set) once the count of **non-dismissed** reports reaches the threshold.
- The threshold is configurable via `CAMPAIGN_REPORT_AUTO_FLAG_THRESHOLD`
  (default `10`). Set it to `0` to disable auto-flagging.
- `autoFlagged` in the POST response is `true` only on the request that crosses
  the threshold; `flaggedForReview` reflects the current flag state.

## Admin authentication

`adminAuthMiddleware` guards the `/api/admin/*` routes:

- `ADMIN_API_KEYS` — comma-separated list of accepted admin keys, supplied as
  `Authorization: Bearer <admin-key>`.
- When `ADMIN_API_KEYS` is unset: allowed in development/test, refused with `503`
  (`ADMIN_NOT_CONFIGURED`) when `NODE_ENV=production`.

## Data model

```sql
CREATE TABLE campaign_reports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id  TEXT NOT NULL REFERENCES campaigns(id),
  reporter     TEXT NOT NULL,
  reason       TEXT NOT NULL CHECK(reason IN ('fraud','spam','duplicate')),
  details      TEXT,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK(status IN ('pending','dismissed','actioned')),
  created_at   INTEGER NOT NULL,
  resolved_at  INTEGER,
  resolved_by  TEXT
);
-- one report per (campaign, reporter)
CREATE UNIQUE INDEX idx_campaign_reports_reporter_unique
  ON campaign_reports(campaign_id, reporter);
```

`campaigns` gains `flagged_for_review INTEGER NOT NULL DEFAULT 0` and
`flagged_at INTEGER`.
