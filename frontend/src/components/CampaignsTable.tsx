import { useMemo, useState } from "react";
import { LayoutGrid } from "lucide-react";
import { Campaign } from "../types/campaign";
import { AssetFilterDropdown } from "./AssetFilterDropdown";
import { EmptyState } from "./EmptyState";
import { CampaignCard } from "./CampaignCard";
import { applyFilters, getDistinctAssetCodes } from "./campaignsTableUtils";

interface CampaignsTableProps {
  campaigns: Campaign[];
  selectedCampaignId: string | null;
  onSelect: (campaignId: string) => void;
  isLoading?: boolean;
  invalidUrlCampaignId?: string | null;
}

function formatTimestamp(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString();
}

// Use the shared `AssetFilterDropdown` component from ./AssetFilterDropdown

export function CampaignsTable({
  campaigns,
  selectedCampaignId,
  onSelect,
  invalidUrlCampaignId,
  isLoading = false,
}: CampaignsTableProps) {
  const [selectedAssetCode, setSelectedAssetCode] = useState("");
  const distinctAssetCodes = useMemo(
    () => getDistinctAssetCodes(campaigns),
    [campaigns],
  );
  const filteredCampaigns = useMemo(
    () => applyFilters(campaigns, selectedAssetCode, ""),
    [campaigns, selectedAssetCode],
  );
  const isEmpty = campaigns.length === 0;

  if (isLoading) {
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
        {isEmpty ? (
          <p className="muted">
            No campaigns yet. Create the first vault to make this board active.
          </p>
        ) : (
          <p className="muted">
            Monitor progress and open one campaign at a time in the action
            panel.
          </p>
        )}
      </div>

      {invalidUrlCampaignId && (
        <p className="banner-warn muted">
          Campaign <code>#{invalidUrlCampaignId}</code> from the URL was not
          found. Showing the first available campaign instead.
        </p>
      )}

      <div className="board-controls">
        <AssetFilterDropdown
          options={distinctAssetCodes}
          value={selectedAssetCode}
          onChange={setSelectedAssetCode}
          disabled={campaigns.length === 0}
        />
      </div>

      {filteredCampaigns.length === 0 ? (
        <p className="muted">No campaigns match the current filters.</p>
      ) : (
        <>
          {/* Desktop / larger screens: table view */}
          <div className="table-only">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Campaign</th>
                    <th>Creator</th>
                    <th>Funding</th>
                    <th>Status</th>
                    <th>Deadline</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filteredCampaigns.map((campaign: Campaign) => (
                    <tr key={campaign.id}>
                      <td>
                        <div className="stacked">
                          <strong>{campaign.title}</strong>
                          <span className="muted">#{campaign.id}</span>
                        </div>
                      </td>
                      <td className="mono">
                        {campaign.creator.slice(0, 8)}...
                      </td>
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
                          {campaign.progress.status}
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
          </div>

          {/* Mobile / small screens: stacked card view */}
          <div className="cards-only">
            {filteredCampaigns.map((campaign: Campaign) => (
              <CampaignCard
                key={campaign.id}
                campaign={campaign}
                selectedCampaignId={selectedCampaignId}
                onSelect={onSelect}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
