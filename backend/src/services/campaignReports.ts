import { config } from '../config';
import { AppError } from '../types/errors';
import { getDb } from './db';

export const CAMPAIGN_REPORT_REASONS = ['fraud', 'spam', 'duplicate'] as const;
export type CampaignReportReason = (typeof CAMPAIGN_REPORT_REASONS)[number];

export const CAMPAIGN_REPORT_STATUSES = ['pending', 'dismissed', 'actioned'] as const;
export type CampaignReportStatus = (typeof CAMPAIGN_REPORT_STATUSES)[number];

export interface CampaignReportRecord {
  id: number;
  campaignId: string;
  reporter: string;
  reason: CampaignReportReason;
  details?: string;
  status: CampaignReportStatus;
  createdAt: number;
  resolvedAt?: number;
  resolvedBy?: string;
}

interface CampaignReportRow {
  id: number;
  campaign_id: string;
  reporter: string;
  reason: CampaignReportReason;
  details: string | null;
  status: CampaignReportStatus;
  created_at: number;
  resolved_at: number | null;
  resolved_by: string | null;
}

export interface CreateCampaignReportInput {
  reporter: string;
  reason: CampaignReportReason;
  details?: string;
}

export interface CreateCampaignReportResult {
  report: CampaignReportRecord;
  /** Total number of unresolved (pending or actioned) reports for the campaign. */
  reportCount: number;
  /** Threshold in effect when the report was filed (0 = auto-flagging disabled). */
  threshold: number;
  /** True when this report pushed the campaign over the threshold. */
  autoFlagged: boolean;
  /** True when the campaign is currently flagged for admin review. */
  flaggedForReview: boolean;
}

export interface ListCampaignReportsOptions {
  status?: CampaignReportStatus | 'all';
  campaignId?: string;
  page: number;
  limit: number;
}

export interface ListCampaignReportsResult {
  reports: CampaignReportRecord[];
  totalCount: number;
}

function nowInSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function rowToReport(row: CampaignReportRow): CampaignReportRecord {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    reporter: row.reporter,
    reason: row.reason,
    details: row.details ?? undefined,
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at ?? undefined,
    resolvedBy: row.resolved_by ?? undefined,
  };
}

/**
 * Resolves the configured auto-flag threshold. A value of `0` (or any
 * non-positive value) disables automatic flagging entirely.
 */
export function getAutoFlagThreshold(): number {
  const configured = config.campaignReportAutoFlagThreshold;
  return Number.isFinite(configured) && configured > 0 ? configured : 0;
}

function getReportById(id: number): CampaignReportRecord | undefined {
  const row = getDb().prepare(`SELECT * FROM campaign_reports WHERE id = ?`).get(id) as
    CampaignReportRow | undefined;
  return row ? rowToReport(row) : undefined;
}

/**
 * Counts reports for a campaign that still contribute towards the auto-flag
 * threshold. Dismissed reports are excluded so a wave of bad-faith reports that
 * an admin clears does not keep a campaign permanently flagged.
 */
function countActiveReports(campaignId: string): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS count FROM campaign_reports
       WHERE campaign_id = ? AND status != 'dismissed'`,
    )
    .get(campaignId) as { count: number };
  return row.count;
}

/**
 * Files an abuse report against a campaign. Each reporter may only report a
 * given campaign once. When the number of active reports reaches the configured
 * threshold the campaign is flagged for admin review.
 */
export function createCampaignReport(
  campaignId: string,
  input: CreateCampaignReportInput,
): CreateCampaignReportResult {
  const db = getDb();

  const campaign = db
    .prepare(`SELECT id, flagged_for_review FROM campaigns WHERE id = ? AND deleted_at IS NULL`)
    .get(campaignId) as { id: string; flagged_for_review: number } | undefined;

  if (!campaign) {
    throw new AppError('Campaign not found.', 404, 'NOT_FOUND');
  }

  const createdAt = nowInSeconds();

  let insertedId: number;
  try {
    const result = db
      .prepare(
        `INSERT INTO campaign_reports (campaign_id, reporter, reason, details, status, created_at)
         VALUES (?, ?, ?, ?, 'pending', ?)`,
      )
      .run(campaignId, input.reporter, input.reason, input.details ?? null, createdAt);
    insertedId = Number(result.lastInsertRowid);
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed/i.test(error.message)) {
      throw new AppError('You have already reported this campaign.', 409, 'DUPLICATE_REPORT');
    }
    throw error;
  }

  const reportCount = countActiveReports(campaignId);
  const threshold = getAutoFlagThreshold();
  const wasFlagged = campaign.flagged_for_review === 1;
  let autoFlagged = false;

  if (threshold > 0 && reportCount >= threshold && !wasFlagged) {
    db.prepare(`UPDATE campaigns SET flagged_for_review = 1, flagged_at = ? WHERE id = ?`).run(
      createdAt,
      campaignId,
    );
    autoFlagged = true;
  }

  const report = getReportById(insertedId);
  if (!report) {
    // Should never happen: the row was just inserted in this connection.
    throw new AppError('Failed to persist campaign report.', 500, 'REPORT_PERSIST_FAILED');
  }

  return {
    report,
    reportCount,
    threshold,
    autoFlagged,
    flaggedForReview: wasFlagged || autoFlagged,
  };
}

/**
 * Lists abuse reports for the admin moderation queue. Defaults to pending
 * reports, newest first.
 */
export function listCampaignReports(
  options: ListCampaignReportsOptions,
): ListCampaignReportsResult {
  const db = getDb();
  const { status = 'pending', campaignId, page, limit } = options;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (status !== 'all') {
    conditions.push('status = ?');
    params.push(status);
  }
  if (campaignId) {
    conditions.push('campaign_id = ?');
    params.push(campaignId);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const totalRow = db
    .prepare(`SELECT COUNT(*) AS count FROM campaign_reports ${whereClause}`)
    .get(...params) as { count: number };

  const offset = (page - 1) * limit;
  const rows = db
    .prepare(
      `SELECT * FROM campaign_reports ${whereClause}
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as CampaignReportRow[];

  return {
    reports: rows.map(rowToReport),
    totalCount: totalRow.count,
  };
}

export interface ResolveCampaignReportInput {
  /** `dismiss` rejects the report; `act` marks that action was taken. */
  action: 'dismiss' | 'act';
  /** Optional Stellar address of the admin resolving the report. */
  admin?: string;
}

/**
 * Resolves a single report. Admins either dismiss a report (no wrongdoing) or
 * mark it as actioned (campaign removed, creator warned, etc.). Already-resolved
 * reports return 409.
 */
export function resolveCampaignReport(
  reportId: number,
  input: ResolveCampaignReportInput,
): CampaignReportRecord {
  const db = getDb();

  const existing = getReportById(reportId);
  if (!existing) {
    throw new AppError('Report not found.', 404, 'NOT_FOUND');
  }
  if (existing.status !== 'pending') {
    throw new AppError(
      `Report has already been ${existing.status}.`,
      409,
      'REPORT_ALREADY_RESOLVED',
    );
  }

  const nextStatus: CampaignReportStatus = input.action === 'dismiss' ? 'dismissed' : 'actioned';
  const resolvedAt = nowInSeconds();

  db.prepare(
    `UPDATE campaign_reports
     SET status = ?, resolved_at = ?, resolved_by = ?
     WHERE id = ?`,
  ).run(nextStatus, resolvedAt, input.admin ?? null, reportId);

  const updated = getReportById(reportId);
  if (!updated) {
    throw new AppError('Failed to update campaign report.', 500, 'REPORT_PERSIST_FAILED');
  }
  return updated;
}
