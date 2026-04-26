import { useState } from "react";
import "./TransactionPreviewModal.css";

export interface TransactionPreviewData {
  operation: string;
  amount?: number;
  contract: string;
  xdr: string;
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

  return (
    <div className="modal-overlay">
      <div className="card modal-content animate-fade-in">
        <div className="section-heading">
          <h2>Transaction Preview</h2>
          <p className="muted">Review the operation details before signing.</p>
        </div>

        <div className="detail-grid" style={{ marginBottom: "24px" }}>
          <article className="detail-stat">
            <span>Operation</span>
            <strong>{preview.operation}</strong>
          </article>
          {preview.amount !== undefined && (
            <article className="detail-stat">
              <span>Amount</span>
              <strong>{preview.amount}</strong>
            </article>
          )}
          <article className="detail-stat" style={{ gridColumn: "1 / -1" }}>
            <span>Target Contract</span>
            <strong className="mono" style={{ wordBreak: "break-all" }}>
              {preview.contract}
            </strong>
          </article>
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
            <div className="xdr-content mono">
              {preview.xdr}
            </div>
          )}
        </div>

        <div className="action-row" style={{ marginTop: "32px", justifyContent: "flex-end" }}>
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
