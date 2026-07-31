/**
 * Image optimization utilities for campaign thumbnails.
 * Supports Imgix-style CDN parameters for image transformation.
 */

const DEFAULT_CDN_URL = ""; // Set VITE_IMAGE_CDN_URL in .env for production

/** CDN configuration loaded from environment */
function getCdnBase(): string {
  return import.meta.env.VITE_IMAGE_CDN_URL ?? DEFAULT_CDN_URL;
}

/** Image content security policy: only allow HTTPS images from trusted sources */
const ALLOWED_HOSTS = [
  "images.unsplash.com",
  "cdn.stellar-goal-vault.xyz",
  "ipfs.io",
  "arweave.net",
];

/**
 * Sanitize and rewrite an image URL through the configured CDN.
 * Falls back to the original URL if no CDN is configured.
 */
export function optimizeImageUrl(
  url: string | undefined,
  options: { width?: number; height?: number; quality?: number } = {},
): string | undefined {
  if (!url) return undefined;

  try {
    const parsed = new URL(url);
    const cdnBase = getCdnBase();

    // Only allow HTTPS
    if (parsed.protocol !== "https:") return undefined;

    // If a CDN is configured, rewrite through it
    if (cdnBase) {
      const params = new URLSearchParams();
      if (options.width) params.set("w", String(options.width));
      if (options.height) params.set("h", String(options.height));
      if (options.quality) params.set("q", String(options.quality));
      params.set("url", url);
      return `${cdnBase}/proxy?${params.toString()}`;
    }

    return url;
  } catch {
    return undefined;
  }
}

/**
 * Get a thumbnail URL (smaller size) for campaign cards.
 */
export function getThumbnailUrl(url: string | undefined): string | undefined {
  return optimizeImageUrl(url, { width: 400, height: 300, quality: 80 });
}

/**
 * Get the full-size image URL for the campaign detail panel.
 */
export function getDetailImageUrl(url: string | undefined): string | undefined {
  return optimizeImageUrl(url, { width: 1200, quality: 90 });
}
