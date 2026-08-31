import { useState } from 'react';
import { Campaign } from '../types/campaign';

interface ShareButtonsProps {
  campaign: Campaign;
}

function buildCampaignUrl(campaignId: string): string {
  return `${window.location.origin}/campaigns/${campaignId}`;
}

function buildTwitterUrl(campaign: Campaign, campaignUrl: string): string {
  const text = `Check out "${campaign.title}" — goal: ${campaign.targetAmount} ${campaign.assetCode}`;
  const params = new URLSearchParams({ text, url: campaignUrl });
  return `https://twitter.com/intent/tweet?${params.toString()}`;
}

function buildFarcasterUrl(campaign: Campaign, campaignUrl: string): string {
  const text = `Check out "${campaign.title}" — goal: ${campaign.targetAmount} ${campaign.assetCode} ${campaignUrl}`;
  const params = new URLSearchParams({ text });
  return `https://warpcast.com/~/compose?${params.toString()}`;
}

function buildLensUrl(campaign: Campaign, campaignUrl: string): string {
  const content = `Check out "${campaign.title}" — goal: ${campaign.targetAmount} ${campaign.assetCode} ${campaignUrl}`;
  const params = new URLSearchParams({ content });
  return `https://hey.xyz/?${params.toString()}`;
}

export function ShareButtons({ campaign }: ShareButtonsProps) {
  const [copied, setCopied] = useState(false);

  const campaignUrl = buildCampaignUrl(campaign.id);
  const twitterUrl = buildTwitterUrl(campaign, campaignUrl);
  const farcasterUrl = buildFarcasterUrl(campaign, campaignUrl);
  const lensUrl = buildLensUrl(campaign, campaignUrl);

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(campaignUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // navigator.clipboard may be unavailable in some embedded contexts; fallback
      const ta = document.createElement('textarea');
      ta.value = campaignUrl;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      } catch {
        // ignore
      } finally {
        document.body.removeChild(ta);
      }
    }
  }

  return (
    <div className="share-buttons" role="group" aria-label="Share campaign">
      <a
        href={twitterUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="btn-ghost"
        aria-label={`Share "${campaign.title}" on Twitter`}
      >
        Twitter
      </a>

      <a
        href={farcasterUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="btn-ghost"
        aria-label={`Share "${campaign.title}" on Farcaster`}
      >
        Farcaster
      </a>

      <a
        href={lensUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="btn-ghost"
        aria-label={`Share "${campaign.title}" on Lens`}
      >
        Lens
      </a>

      <button
        type="button"
        className="btn-ghost btn-copy"
        onClick={() => { void handleCopyLink(); }}
        aria-label="Copy campaign link"
        title={copied ? 'Copied!' : 'Copy link'}
      >
        {copied ? 'Copied' : 'Copy link'}
      </button>
    </div>
  );
}

export default ShareButtons;
