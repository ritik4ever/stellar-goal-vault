interface FundingProgressProps {
  percentFunded: number;
  pledgedAmount: number;
  targetAmount: number;
  assetCode: string;
  acceptedTokens?: string[];
  tokenBalances?: Record<string, number>;
}

export function FundingProgress({
  percentFunded,
  pledgedAmount,
  targetAmount,
  assetCode,
  acceptedTokens = [],
  tokenBalances = {},
}: FundingProgressProps) {
  return (
    <div className="campaign-progress">
      <div className="progress-copy">
        {pledgedAmount} / {targetAmount} {acceptedTokens.length > 1 ? 'Tokens' : assetCode}
      </div>
      {acceptedTokens.length > 1 && tokenBalances ? (
        <div className="token-progress-list" aria-label="Per-token progress">
          {acceptedTokens.map((token) => {
            const balance = tokenBalances[token] ?? 0;
            const pct = targetAmount > 0
              ? Math.min(Math.round((balance / targetAmount) * 100), 100)
              : 0;
            return (
              <div key={token} className="token-progress-row">
                <span className="token-label muted">{token}</span>
                <div className="progress-bar" aria-hidden>
                  <div style={{ width: `${pct}%` }} />
                </div>
                <span className="token-balance muted">{balance}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="progress-bar" aria-hidden>
          <div style={{ width: `${Math.min(percentFunded, 100)}%` }} />
        </div>
      )}
      <div className="muted">{percentFunded}% funded</div>
    </div>
  );
}
