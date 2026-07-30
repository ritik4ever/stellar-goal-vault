import type { FormEvent, useState } from 'react';
import type { Campaign } from '../types/campaign';

interface PledgeFormProps {
  campaign: Campaign;
  connectedWallet?: string | null;
  isSubmitting?: boolean;
  isPledgePending?: boolean;
  pledgeError?: string | null;
  acceptedTokens?: string[];
  onPledge: (campaignId: string, amount: number, assetCode: string) => Promise<void>;
  onClaim?: (campaign: Campaign) => Promise<void>;
  onRefund?: (campaignId: string, contributor: string) => Promise<void>;
  refundContributor?: string;
  onRefundContributorChange?: (value: string) => void;
  walletReady?: boolean;
  onConnectWallet?: () => Promise<void>;
  onDisconnectWallet?: () => void;
}

export function PledgeForm({
  campaign,
  connectedWallet = null,
  isSubmitting = false,
  isPledgePending = false,
  pledgeError = null,
  acceptedTokens = [],
  onPledge,
  onClaim,
  walletReady = true,
}: PledgeFormProps) {
  const [amount, setAmount] = useState('25');
  const [token, setToken] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);

  const selectedToken = token || campaign.assetCode;

  async function handlePledge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError(null);
    try {
      await onPledge(campaign.id, Number(amount), selectedToken);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Pledge failed');
    }
  }

  return (
    <form className="form-grid" onSubmit={handlePledge}>
      <label className="field-group">
        <span>Pledge amount ({selectedToken})</span>
        <input
          type="number"
          min="0.01"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />
      </label>

      {acceptedTokens.length > 1 && (
        <label className="field-group">
          <span>Token</span>
          <select value={selectedToken} onChange={(e) => setToken(e.target.value)} required>
            {acceptedTokens.map((token) => (
              <option key={token} value={token}>{token}</option>
            ))}
          </select>
        </label>
      )}

      <div className="action-row">
        <button
          className="btn-primary"
          type="submit"
          disabled={isSubmitting || isPledgePending || !campaign.progress.canPledge || !connectedWallet}
        >
          {isPledgePending ? 'Submitting...' : 'Add pledge'}
        </button>

        {onClaim && (
          <button
            className="btn-ghost"
            type="button"
            disabled={isSubmitting || !campaign.progress.canClaim || !connectedWallet || connectedWallet !== campaign.creator || !walletReady}
            onClick={() => { void onClaim(campaign); }}
          >
            Claim vault
          </button>
        )}
      </div>

      {(pledgeError || submitError) && (
        <div className="pledge-error" role="alert">
          <p className="error-text">{pledgeError || submitError}</p>
        </div>
      )}

      {isPledgePending && (
        <p className="pending-note">
          The pledge transaction is in flight. Campaign state will refresh after the backend reconciles the result.
        </p>
      )}
    </form>
  );
}
