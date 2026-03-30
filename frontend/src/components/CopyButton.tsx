import { useState } from "react";

interface CopyButtonProps {
  value: string;
  ariaLabel?: string;
  className?: string;
}

export function CopyButton({
  value,
  ariaLabel = "Copy value",
  className = "",
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      // navigator.clipboard may be unavailable in some embedded contexts; fallback
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      } catch (e) {
        // ignore
      } finally {
        document.body.removeChild(ta);
      }
    }
  }

  return (
    <button
      type="button"
      className={`btn-ghost btn-copy ${className}`}
      onClick={handleCopy}
      aria-label={ariaLabel}
      title={copied ? "Copied!" : "Copy full address"}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export default CopyButton;
