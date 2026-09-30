-- 003_add_notifications: per-wallet notification inbox.

CREATE TABLE notifications (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id   TEXT NOT NULL,
  type          TEXT NOT NULL CHECK(type IN ('new_pledge', 'campaign_funded', 'refund_available', 'creator_update')),
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  target_wallet TEXT NOT NULL,
  actor_wallet  TEXT,
  is_read       INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
);

CREATE INDEX idx_notifications_target_wallet
  ON notifications(target_wallet, created_at DESC);

CREATE INDEX idx_notifications_unread
  ON notifications(target_wallet, is_read);

-- FK child discovery when the seed wipe deletes campaigns.
CREATE INDEX idx_notifications_campaign_id
  ON notifications(campaign_id);
