import { useState, useEffect, useCallback, useRef } from 'react';
import './TransactionPreviewModal.css';

export interface TransactionPreviewData {
  operation: string;
  amount?: number;
  /** Asset code displayed alongside the amount (e.g. "USDC", "XLM"). */
  assetCode?: string;
  contract: string;
  xdr: string;
  estimatedFee?: {
    stroops: number;
    xlm: string;
  };
}

interface TransactionPreviewModalProps {
  preview: TransactionPreviewData;
  onConfirm: () => void;
  onCancel: () => void;
}

const FOCUSABLE_SELECTORS =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function TransactionPreviewModal({
  preview,
  onConfirm,
  onCancel,
}: TransactionPreviewModalProps) {
  const [showXdr, setShowXdr] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Store the previously focused element and lock body scroll
  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = '';
      previousFocusRef.current?.focus();
    };
  }, []);

  // Focus trap and Escape handler
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCancel();
        return;
      }

      if (event.key === 'Tab' && dialogRef.current) {
        const focusable = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS),
        );
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (event.shiftKey) {
          if (document.activeElement === first) {
            event.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      }
    },
    [onCancel],
  );

  return (
    <div className="modal-overlay" role="presentation">
      <div
        className="card modal-content animate-fade-in"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tx-preview-title"
        ref={dialogRef}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <div className="section-heading">
          <h2 id="tx-preview-title">Transaction Preview</h2>
          <p className="muted">Review the operation details before signing.</p>
        </div>

        <div className="detail-grid" style={{ marginBottom: '24px' }}>
          <article className="detail-stat">
            <span>Operation</span>
            <strong>{preview.operation}</strong>
          </article>
          {preview.amount !== undefined && (
            <article className="detail-stat">
              <span>Amount</span>
              <strong>
                {preview.amount}
                {preview.assetCode ? ` ${preview.assetCode}` : ''}
              </strong>
            </article>
          )}
          <article className="detail-stat" style={{ gridColumn: '1 / -1' }}>
            <span>Target Contract</span>
            <strong className="mono" style={{ wordBreak: 'break-all' }}>
              {preview.contract}
            </strong>
          </article>

          {preview.estimatedFee && (
            <article className="detail-stat">
              <span>Estimated network fee</span>
              <strong>
                {preview.estimatedFee.xlm} XLM ({preview.estimatedFee.stroops} stroops)
              </strong>
            </article>
          )}

          {!preview.estimatedFee && (
            <article className="detail-stat">
              <span>Estimated network fee</span>
              <strong className="muted">Calculating...</strong>
            </article>
          )}
        </div>

        <div className="xdr-section">
          <label className="xdr-toggle">
            <input
              type="checkbox"
              checked={showXdr}
              onChange={(e) => setShowXdr(e.target.checked)}
            />
            <span>Show raw XDR</span>
          </label>

          {showXdr && <div className="xdr-content mono">{preview.xdr}</div>}
        </div>

        <div className="action-row" style={{ marginTop: '32px', justifyContent: 'flex-end' }}>
          <button className="btn-ghost" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn-primary" type="button" onClick={onConfirm}>
            Confirm and Sign
          </button>
        </div>
      </div>
    </div>
  );
}
