import { LayoutGrid } from "lucide-react";
import { useMemo, useState } from "react";
import { useDebounce } from "../hooks/useDebounce";
import { Campaign, CampaignStatus } from "../types/campaign";
import { EmptyState } from "./EmptyState";
import { AssetFilterDropdown } from "./AssetFilterDropdown";
import {
  applyFilters,
  getDistinctAssetCodes,
  sortCampaigns,
} from "./campaignsTableUtils";
import { SearchInput } from "./SearchInput";
import { SortDropdown, SortOption } from "./SortDropdown";

type StatusFilterValue = "" | CampaignStatus;

const STATUS_FILTERS: Array<{ value: StatusFilterValue; label: string }> = [
  { value: "", label: "All" },
  { value: "open", label: "Open" },
  { value: "funded", label: "Funded" },
  { value: "claimed", label: "Claimed" },
  { value: "failed", label: "Failed" },
];

interface CampaignsTableProps {
  campaigns: Campaign[];
  selectedCampaignId: string | null;
  onSelect: (campaignId: string) => void;
  isLoading?: boolean;
  invalidUrlCampaignId?: string | null;
}

function formatTimestamp(value: number | string): string {
  const date =
    typeof value === "number" ? new Date(value * 1000) : new Date(value);

  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function getStatusLabel(status: Campaign["progress"]["status"]): string {
  switch (status) {
    case "open":
      return "open";
    case "funded":
      return "funded";
    case "claimed":
      return "claimed";
    case "failed":
      return "failed";
    default:
      return status;
  }
}

export function CampaignsTable({
  campaigns,
  selectedCampaignId,
  onSelect,
  isLoading = false,
  invalidUrlCampaignId = null,
}: CampaignsTableProps) {
  const [assetCode, setAssetCode] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>("");
  const [sortBy, setSortBy] = useState<SortOption>("newest");
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  const isEmpty = campaigns.length === 0;

  const assetOptions = useMemo(
    () => getDistinctAssetCodes(campaigns),
    [campaigns],
  );
  const statusCounts = useMemo(() => {
    const counts: Record<CampaignStatus, number> = {
      open: 0,
      funded: 0,
      claimed: 0,
      failed: 0,
    };

    campaigns.forEach((campaign) => {
      counts[campaign.progress.status] += 1;
    });

    return {
      all: campaigns.length,
      ...counts,
    };
  }, [campaigns]);

  const filteredCampaigns = useMemo(() => {
    const filtered = applyFilters(
      campaigns,
      assetCode,
      statusFilter,
      debouncedSearchQuery,
    );
    return sortCampaigns(filtered, sortBy);
  }, [campaigns, assetCode, statusFilter, debouncedSearchQuery, sortBy]);

  if (isLoading && isEmpty) {
    return (
      <section className="card">
        <div className="section-heading">
          <h2>Campaign board</h2>
          <p className="muted">Loading campaigns...</p>
        </div>
      </section>
    );
  }

  if (isEmpty) {
    return (
      <EmptyState
        variant="card"
        icon={LayoutGrid}
        title="Campaign board"
        message="No campaigns yet. Create the first vault to make this board active."
      />
    );
  }

  return (
    <section className="card">
      <div className="section-heading">
        <h2>Campaign board</h2>
        <p className="muted">
          Monitor progress and open one campaign at a time in the action panel.
        </p>
      </div>

      {invalidUrlCampaignId ? (
        <p className="banner-warn muted">
          Campaign <code>#{invalidUrlCampaignId}</code> from the URL was not
          found. Showing the first available campaign instead.
        </p>
      ) : null}

      <div className="board-controls">
        <SearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          disabled={isLoading}
        />
        <label className="field-group" style={{ minWidth: 180 }}>
          <span>Asset:</span>
          <AssetFilterDropdown
            options={assetOptions}
            value={assetCode}
            onChange={setAssetCode}
            disabled={isLoading}
          />
        </label>
        <label className="field-group" style={{ minWidth: 180 }}>
          <span>Status:</span>
          <div
            className="status-filter-tabs"
            role="tablist"
            aria-label="Filter campaigns by status"
          >
            {STATUS_FILTERS.map((filter) => {
              const isActive = statusFilter === filter.value;
              const count =
                filter.value === ""
                  ? statusCounts.all
                  : statusCounts[filter.value];

              return (
                <button
                  key={filter.label}
                  type="button"
                  className={`status-filter-tab ${isActive ? "status-filter-tab-active" : ""}`}
                  onClick={() => setStatusFilter(filter.value)}
                  aria-pressed={isActive}
                  disabled={isLoading}
                >
                  <span>{filter.label}</span>
                  <span className="status-filter-count">{count}</span>
                </button>
              );
            })}
          </div>
        </label>
        <label className="field-group" style={{ minWidth: 180 }}>
          <span>Sort:</span>
          <SortDropdown
            value={sortBy}
            onChange={setSortBy}
            disabled={isLoading}
          />
        </label>
      </div>

      {filteredCampaigns.length === 0 ? (
        <EmptyState
          variant="inline"
          title="No campaigns found"
          message="Try adjusting your search or filters."
        />
      ) : (
        <>
          <div className="table-wrap table-only">
            <table>
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Creator</th>
                  <th>Funding</th>
                  <th>Status</th>
                  <th>Deadline</th>
                  <th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {filteredCampaigns.map((campaign) => (
                  <tr key={campaign.id}>
                    <td>
                      <div className="stacked">
                        <strong>{campaign.title}</strong>
                        <span className="muted">#{campaign.id}</span>
                      </div>
                    </td>
                    <td className="mono">{campaign.creator.slice(0, 12)}...</td>
                    <td>
                      <div className="progress-copy">
                        {campaign.pledgedAmount} / {campaign.targetAmount}{" "}
                        {campaign.assetCode}
                      </div>
                      <div className="progress-bar" aria-hidden>
                        <div
                          style={{
                            width: `${Math.min(campaign.progress.percentFunded, 100)}%`,
                          }}
                        />
                      </div>
                      <span className="muted">
                        {campaign.progress.percentFunded}% funded
                      </span>
                    </td>
                    <td>
                      <span
                        className={`badge badge-${campaign.progress.status}`}
                      >
                        {getStatusLabel(campaign.progress.status)}
                      </span>
                    </td>
                    <td className="stacked">
                      <span>{formatTimestamp(campaign.deadline)}</span>
                      <span className="muted">
                        {campaign.progress.hoursLeft}h left
                      </span>
                    </td>
                    <td>
                      <button
                        className={
                          selectedCampaignId === campaign.id
                            ? "btn-secondary"
                            : "btn-ghost"
                        }
                        type="button"
                        onClick={() => onSelect(campaign.id)}
                      >
                        {selectedCampaignId === campaign.id
                          ? "Selected"
                          : "View"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="cards-only">
            {filteredCampaigns.map((campaign) => (
              <article
                key={campaign.id}
                className={`campaign-card ${
                  selectedCampaignId === campaign.id
                    ? "campaign-card-selected"
                    : ""
                }`}
              >
                <div className="campaign-card-main">
                  <div className="campaign-card-header">
                    <strong className="campaign-title">{campaign.title}</strong>
                    <span className={`badge badge-${campaign.progress.status}`}>
                      {getStatusLabel(campaign.progress.status)}
                    </span>
                  </div>
                  <span className="campaign-creator mono">
                    {campaign.creator.slice(0, 16)}...
                  </span>
                  <div className="campaign-progress">
                    <div className="progress-copy">
                      {campaign.pledgedAmount} / {campaign.targetAmount}{" "}
                      {campaign.assetCode}
                    </div>
                    <div className="progress-bar" aria-hidden>
                      <div
                        style={{
                          width: `${Math.min(campaign.progress.percentFunded, 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                  <div className="campaign-meta">
                    <span className="muted">
                      {campaign.progress.hoursLeft}h left
                    </span>
                    <span className="muted">
                      {formatTimestamp(campaign.deadline)}
                    </span>
                  </div>
                </div>
                <div className="campaign-card-actions">
                  <button
                    className={
                      selectedCampaignId === campaign.id
                        ? "btn-secondary"
                        : "btn-ghost"
                    }
                    type="button"
                    onClick={() => onSelect(campaign.id)}
                  >
                    {selectedCampaignId === campaign.id ? "Selected" : "View"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
