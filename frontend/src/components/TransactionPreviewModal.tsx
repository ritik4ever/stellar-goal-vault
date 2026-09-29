import { useEffect, useRef from 'react';
import { useState } from 'react';
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

export function TransactionPreviewModal({
  preview,
  onConfirm,
  onCancel,
}: TransactionPreviewModalProps) {
  const [showXdr, setShowXdr] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onCancel();
      return;
    }

    if (event.key !== 'Tab') {
      return;
    }

    const focusable = modalRef.current?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );

    if (!focusable || focusable.length === 0) {
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement as HTMLElement | null;

    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="modal-overlay">
      <div
        className="card modal-content animate-fade-in"
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="transaction-preview-title"
        aria-describedby="transaction-preview-description"
        onKeyDown={handleKeyDown}
      >
        <div className="section-heading">
          <h2 id="transaction-preview-title">Transaction Preview</h2>
          <p id="transaction-preview-description" className="muted">
            Review the operation details before signing.
          </p>
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

          {showXdr && (
            <div className="xdr-content mono" aria-live="polite">
              {preview.xdr}
            </div>
          )}
        </div>

        <div className="action-row" style={{ marginTop: '32px', justifyContent: 'flex-end' }}>
          <button className="btn-ghost" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn-primary"
            type="button"
            onClick={onConfirm}
            ref={confirmRef}
          >
            Confirm and Sign
          </button>
        </div>
      </div>
    </div>
  );
}
