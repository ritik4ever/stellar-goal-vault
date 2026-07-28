import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Campaign } from '../types/campaign';
import { listCampaigns, claimCampaign } from '../services/api';
import { useFreighter } from '../hooks/useFreighter';
import CampaignCard from '../components/CampaignCard';
import EmptyState from '../components/EmptyState';
import CreatorAnalytics from '../components/CreatorAnalytics';

export default function CreatorDashboard() {
  const freighter = useFreighter();
  const connected = Boolean(freighter.publicKey);
  const publicKey = freighter.publicKey;
  const navigate = useNavigate();

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);

  // Simple UI modal state
  const [showExtendModal, setShowExtendModal] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [showClaimConfirm, setShowClaimConfirm] = useState(false);
  const [activeCampaign, setActiveCampaign] = useState<Campaign | null>(null);

  useEffect(() => {
    async function load() {
      if (!publicKey) return;
      setLoading(true);
      try {
        // load a reasonable number of campaigns and filter client-side by creator
        const resp = await listCampaigns({ limit: 200 });
        const owned = resp.data.filter((c) => c.creator === publicKey);
        setCampaigns(owned);
      } catch (err) {
        // swallow — page will show empty state
        setCampaigns([]);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [publicKey]);

  const sections = useMemo(() => {
    const active: Campaign[] = [];
    const fundedWaiting: Campaign[] = [];
    const past: Campaign[] = [];

    for (const c of campaigns) {
      if (c.progress.status === 'open') active.push(c);
      else if (c.progress.status === 'funded' && !c.claimed) fundedWaiting.push(c);
      else past.push(c);
    }

    return { active, fundedWaiting, past };
  }, [campaigns]);

  function handleSelect(campaignId: string) {
    setSelectedCampaignId(campaignId);
    navigate(`/campaigns/${campaignId}`);
  }

  function openExtendModal(c: Campaign) {
    setActiveCampaign(c);
    setShowExtendModal(true);
  }

  function openUpdateModal(c: Campaign) {
    setActiveCampaign(c);
    setShowUpdateModal(true);
  }

  function openClaimConfirm(c: Campaign) {
    setActiveCampaign(c);
    setShowClaimConfirm(true);
  }

  async function doClaim() {
    if (!activeCampaign || !publicKey) return;
    try {
      // Call backend claim endpoint (creator must match publicKey)
      await claimCampaign(activeCampaign.id, publicKey, '', Date.now());
      // refresh list
      const resp = await listCampaigns({ limit: 200 });
      setCampaigns(resp.data.filter((c) => c.creator === publicKey));
    } catch (err) {
      // no-op for now
    } finally {
      setShowClaimConfirm(false);
      setActiveCampaign(null);
    }
  }

  if (!connected) {
    return (
      <div style={{ padding: 24 }}>
        <EmptyState
          title="Connect your wallet"
          description="This dashboard shows campaigns you created. Connect your Freighter wallet to continue."
          primaryAction={{
            label: 'Connect Wallet',
            onClick: () => freighter.connect(undefined as any),
          }}
        />
      </div>
    );
  }

  return (
    <div style={{ padding: 24 }}>
      <h2>Creator dashboard</h2>
      <p className="muted">Wallet: {publicKey}</p>

      {loading ? <div className="muted">Loading...</div> : null}

      {!loading && campaigns.length === 0 && (
        <EmptyState
          title="No campaigns yet"
          description="You don't have any campaigns. Create one to get started."
          primaryAction={{ label: 'Create campaign', onClick: () => navigate('/') }}
        />
      )}

      {!loading && campaigns.length > 0 && (
        <div>
          <section>
            <h3>Active campaigns</h3>
            <div className="card-grid">
              {sections.active.map((c) => (
                <div key={c.id} style={{ width: 320 }}>
                  <CampaignCard
                    campaign={c}
                    selectedCampaignId={selectedCampaignId}
                    onSelect={handleSelect}
                  />
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button className="btn-secondary" onClick={() => openExtendModal(c)}>
                      Extend deadline
                    </button>
                    <button className="btn-secondary" onClick={() => openUpdateModal(c)}>
                      Post update
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h3>Funded — awaiting claim</h3>
            <div className="card-grid">
              {sections.fundedWaiting.map((c) => (
                <div key={c.id} style={{ width: 320 }}>
                  <CampaignCard
                    campaign={c}
                    selectedCampaignId={selectedCampaignId}
                    onSelect={handleSelect}
                  />
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button className="btn-primary" onClick={() => openClaimConfirm(c)}>
                      Claim
                    </button>
                    <button className="btn-secondary" onClick={() => openUpdateModal(c)}>
                      Post update
                    </button>
                    <button className="btn-secondary" onClick={() => setActiveCampaign(c)}>
                      Analytics
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h3>Past campaigns</h3>
            <div className="card-grid">
              {sections.past.map((c) => (
                <div key={c.id} style={{ width: 320 }}>
                  <CampaignCard
                    campaign={c}
                    selectedCampaignId={selectedCampaignId}
                    onSelect={handleSelect}
                  />
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button className="btn-secondary" onClick={() => openUpdateModal(c)}>
                      Post update
                    </button>
                    <button className="btn-secondary" onClick={() => setActiveCampaign(c)}>
                      Analytics
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {activeCampaign && (
            <div style={{ marginTop: 24 }}>
              <h4>Campaign analytics</h4>
              <CreatorAnalytics campaignId={activeCampaign.id} />
            </div>
          )}
        </div>
      )}

      {/* Modals (simple implementations) */}
      {showClaimConfirm && activeCampaign && (
        <div className="modal">
          <div className="modal-content">
            <h3>Confirm claim</h3>
            <p>Claim funds for "{activeCampaign.title}"?</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-primary" onClick={doClaim}>
                Confirm
              </button>
              <button className="btn-secondary" onClick={() => setShowClaimConfirm(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showExtendModal && activeCampaign && (
        <div className="modal">
          <div className="modal-content">
            <h3>Request deadline extension</h3>
            <p>Feature placeholder — extension requests are managed on-chain.</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-primary" onClick={() => setShowExtendModal(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showUpdateModal && activeCampaign && (
        <div className="modal">
          <div className="modal-content">
            <h3>Post an update</h3>
            <textarea style={{ width: '100%', minHeight: 120 }} placeholder="Write an update..." />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="btn-primary" onClick={() => setShowUpdateModal(false)}>
                Post
              </button>
              <button className="btn-secondary" onClick={() => setShowUpdateModal(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
