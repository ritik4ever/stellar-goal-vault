import { useCallback, useRef } from 'react';
import type { Campaign } from '../types/campaign';

const CANVAS_W = 1200;
const CANVAS_H = 630;

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

function drawCard(
  ctx: CanvasRenderingContext2D,
  campaign: Campaign,
  brandLogoUrl?: string,
): void {
  const w = CANVAS_W;
  const h = CANVAS_H;

  const gradient = ctx.createLinearGradient(0, 0, w, h);
  gradient.addColorStop(0, '#0f172a');
  gradient.addColorStop(0.5, '#1e293b');
  gradient.addColorStop(1, '#0f172a');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);

  const glowGrad = ctx.createRadialGradient(120, 0, 0, 120, 0, 500);
  glowGrad.addColorStop(0, 'rgba(99, 102, 241, 0.18)');
  glowGrad.addColorStop(1, 'transparent');
  ctx.fillStyle = glowGrad;
  ctx.fillRect(0, 0, w, h);

  const glowGrad2 = ctx.createRadialGradient(w, h, 0, w, h, 550);
  glowGrad2.addColorStop(0, 'rgba(168, 85, 247, 0.12)');
  glowGrad2.addColorStop(1, 'transparent');
  ctx.fillStyle = glowGrad2;
  ctx.fillRect(0, 0, w, h);

  const pct = campaign.progress.percentFunded / 100;
  const barX = 60;
  const barY = 320;
  const barW = w - 120;
  const barH = 14;

  ctx.font = '600 18px "Outfit", system-ui, sans-serif';
  ctx.fillStyle = '#6366f1';
  ctx.textBaseline = 'middle';
  ctx.fillText('STELLAR GOAL VAULT', barX, 60);

  if (brandLogoUrl) {
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = brandLogoUrl;
      ctx.save();
      ctx.beginPath();
      ctx.arc(w - 60, 60, 24, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(img, w - 84, 36, 48, 48);
      ctx.restore();
    } catch {
    }
  }

  ctx.font = '700 52px "Outfit", system-ui, sans-serif';
  ctx.fillStyle = '#f8fafc';
  ctx.textBaseline = 'top';
  const title = truncate(campaign.title, 60);
  const lines = title.length > 30 ? [title.slice(0, 30), title.slice(30)] : [title];
  lines.forEach((line, i) => {
    ctx.fillText(line, barX, 110 + i * 60);
  });

  let statusColor = '#6366f1';
  let statusLabel = 'OPEN';
  if (campaign.progress.status === 'funded') {
    statusColor = '#22c55e';
    statusLabel = 'FUNDED';
  } else if (campaign.progress.status === 'claimed') {
    statusColor = '#a855f7';
    statusLabel = 'CLAIMED';
  }

  ctx.font = '700 14px "Outfit", system-ui, sans-serif';
  ctx.fillStyle = statusColor;
  ctx.textBaseline = 'middle';
  const statusW = ctx.measureText(statusLabel).width;
  const statusX = w - barX - statusW - 24;
  const statusY = 124;
  ctx.fillRect(statusX - 12, statusY - 14, statusW + 24, 28);
  ctx.fillStyle = '#0f172a';
  ctx.fillText(statusLabel, statusX, statusY);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '400 16px "Outfit", system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('Funding Progress', barX, 280);

  const barBgY = barY - 10;
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.beginPath();
  ctx.roundRect(barX, barBgY, barW, barH, 7);
  ctx.fill();

  const fillW = Math.min(barW * pct, barW);
  if (fillW > 0) {
    const barGrad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
    barGrad.addColorStop(0, '#6366f1');
    barGrad.addColorStop(1, '#22c55e');
    ctx.fillStyle = barGrad;
    ctx.beginPath();
    ctx.roundRect(barX, barBgY, fillW, barH, 7);
    ctx.fill();
  }

  ctx.font = '700 22px "Outfit", system-ui, sans-serif';
  ctx.fillStyle = '#f8fafc';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`${fmt(campaign.pledgedAmount)} / ${fmt(campaign.targetAmount)} ${campaign.assetCode}`, barX, 390);

  const deadlineDate = new Date(campaign.deadline * 1000);
  const deadlineStr = deadlineDate.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  const hoursLeft = Math.max(0, campaign.progress.hoursLeft);
  ctx.font = '400 16px "Outfit", system-ui, sans-serif';
  ctx.fillStyle = '#94a3b8';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`Deadline: ${deadlineStr}  ·  ${hoursLeft}h remaining`, barX, 430);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '400 16px "Outfit", system-ui, sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText(`Pledge count: ${campaign.progress.pledgeCount}`, barX, 470);

  ctx.fillStyle = 'rgba(148,163,184,0.3)';
  ctx.font = '400 13px "Outfit", system-ui, sans-serif';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`Campaign ID: ${campaign.id}  ·  stellar-goal-vault.vercel.app`, barX, h - 36);
}

export function useCampaignShareCard() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const generate = useCallback((campaign: Campaign, brandLogoUrl?: string): HTMLCanvasElement => {
    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    drawCard(ctx, campaign, brandLogoUrl);
    canvasRef.current = canvas;
    return canvas;
  }, []);

  const downloadPng = useCallback((campaign: Campaign, brandLogoUrl?: string) => {
    const canvas = generate(campaign, brandLogoUrl);
    const link = document.createElement('a');
    link.download = `campaign_share_${campaign.id}.png`;
    link.href = canvas.toDataURL('image/png');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [generate]);

  const toDataUrl = useCallback((campaign: Campaign, brandLogoUrl?: string): string => {
    const canvas = generate(campaign, brandLogoUrl);
    return canvas.toDataURL('image/png');
  }, [generate]);

  const toBlob = useCallback(async (campaign: Campaign, brandLogoUrl?: string): Promise<Blob | null> => {
    const canvas = generate(campaign, brandLogoUrl);
    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/png');
    });
  }, [generate]);

  return { generate, downloadPng, toDataUrl, toBlob };
}
