import { useState } from "react";

function toBase64(str: string): string {
  if (typeof btoa !== "undefined") return btoa(str);
  return Buffer.from(str).toString("base64");
}

export function proxiedImageUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("w", "400");
    parsed.searchParams.set("q", "80");
    return parsed.toString();
  } catch {
    const separator = url.includes("?") ? "&" : "?";
    return url + separator + "w=400&q=80";
  }
}

interface CampaignImageProps {
  url: string;
  alt: string;
}

export function CampaignImage({ url, alt }: CampaignImageProps) {
  const [hasError, setHasError] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const src = proxiedImageUrl(url);

  const placeholderSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 280">
    <rect width="400" height="280" fill="#1e293b"/>
    <path d="M200 95L265 155H135L200 95Z" fill="#64748b"/>
    <circle cx="200" cy="160" r="25" fill="#64748b"/>
    <text x="200" y="240" font-family="system-ui" font-size="14" fill="#94a3b8" text-anchor="middle">Image unavailable</text>
  </svg>`;
  const placeholderSrc = "data:image/svg+xml;base64," + toBase64(placeholderSvg);

  if (hasError) {
    return (
      <div className="campaign-image-container">
        <img
          src={placeholderSrc}
          alt=""
          width={400}
          height={280}
          className="campaign-image"
        />
      </div>
    );
  }

  return (
    <div className="campaign-image-container">
      <img
        src={src}
        alt={alt}
        className="campaign-image"
        loading="lazy"
        decoding="async"
        width={400}
        height={280}
        onError={() => setHasError(true)}
        onLoad={() => setIsLoaded(true)}
        style={{ opacity: isLoaded ? 1 : 0, transition: "opacity 0.3s ease" }}
      />
      {!isLoaded && <div className="campaign-image-skeleton" />}
    </div>
  );
}
