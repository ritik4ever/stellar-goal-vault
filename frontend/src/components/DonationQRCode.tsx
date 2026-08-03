import { useRef, useEffect } from 'react';
import QRCode from 'qrcode';
import { Download } from 'lucide-react';

interface DonationQRCodeProps {
  stellarAddress: string;
  campaignTitle: string;
}

/**
 * DonationQRCode component displays a QR code encoding the creator's Stellar address
 * for easy donations via any Stellar wallet (Lobstr, Solar, etc.).
 * The QR code can be downloaded as a PNG file.
 */
export function DonationQRCode({ stellarAddress, campaignTitle }: DonationQRCodeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    // Generate QR code on canvas
    QRCode.toCanvas(
      canvasRef.current,
      stellarAddress,
      {
        width: 200,
        margin: 2,
        errorCorrectionLevel: 'H',
        color: {
          dark: '#0f172a',
          light: '#ffffff',
        },
      },
      (error) => {
        if (error) console.error('QR Code generation error:', error);
      }
    );
  }, [stellarAddress]);

  const handleDownload = () => {
    if (!canvasRef.current) return;

    // Convert canvas to blob and download
    canvasRef.current.toBlob((blob) => {
      if (!blob) return;

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'campaign_donate_qr.png';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    });
  };

  return (
    <div className="qr-code-container">
      <div className="qr-code-header">
        <h3>Scan to Donate</h3>
        <p className="muted">Scan with any Stellar wallet (Lobstr, Solar, etc.)</p>
      </div>

      <div className="qr-code-wrapper">
        <canvas
          ref={canvasRef}
          style={{
            border: '8px solid white',
            borderRadius: '12px',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
          }}
        />
      </div>

      <div className="qr-code-address">
        <span className="mono qr-address-text">{stellarAddress}</span>
      </div>

      <button
        type="button"
        className="btn-ghost qr-download-btn"
        onClick={handleDownload}
        aria-label="Download QR code as PNG"
      >
        <Download size={16} />
        Download QR Code
      </button>
    </div>
  );
}
