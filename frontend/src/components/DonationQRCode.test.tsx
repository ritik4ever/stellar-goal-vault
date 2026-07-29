import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DonationQRCode } from './DonationQRCode';
import QRCode from 'qrcode';

vi.mock('qrcode', () => ({
  default: {
    toCanvas: vi.fn((canvas, text, options, callback) => {
      // Simulate successful QR code generation
      if (callback) callback(null);
    }),
  },
}));

// Mock URL.createObjectURL and URL.revokeObjectURL
beforeAll(() => {
  global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
  global.URL.revokeObjectURL = vi.fn();
});

describe('DonationQRCode', () => {
  const mockStellarAddress = 'GDJX5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z';
  const mockCampaignTitle = 'Test Campaign';

  it('renders QR code component with correct elements', () => {
    render(<DonationQRCode stellarAddress={mockStellarAddress} campaignTitle={mockCampaignTitle} />);

    expect(screen.getByText('Scan to Donate')).toBeInTheDocument();
    expect(screen.getByText(/Scan with any Stellar wallet/)).toBeInTheDocument();
    expect(screen.getByText(mockStellarAddress)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Download QR code as PNG/i })).toBeInTheDocument();
  });

  it('renders QR code canvas element', () => {
    const { container } = render(
      <DonationQRCode stellarAddress={mockStellarAddress} campaignTitle={mockCampaignTitle} />
    );

    const canvas = container.querySelector('canvas');
    expect(canvas).toBeInTheDocument();
  });

  it('calls QRCode.toCanvas with correct parameters', async () => {
    render(<DonationQRCode stellarAddress={mockStellarAddress} campaignTitle={mockCampaignTitle} />);

    await waitFor(() => {
      expect(QRCode.toCanvas).toHaveBeenCalled();
    });

    const calls = vi.mocked(QRCode.toCanvas).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0][1]).toBe(mockStellarAddress);
  });

  it('displays the stellar address correctly', () => {
    render(<DonationQRCode stellarAddress={mockStellarAddress} campaignTitle={mockCampaignTitle} />);

    const addressElement = screen.getByText(mockStellarAddress);
    expect(addressElement).toHaveClass('mono');
    expect(addressElement).toHaveClass('qr-address-text');
  });

  it('triggers download when download button is clicked', async () => {
    const user = userEvent.setup();
    const mockBlob = new Blob(['fake-image-data'], { type: 'image/png' });
    const mockToBlob = vi.fn((callback) => {
      callback(mockBlob);
    });

    const { container } = render(
      <DonationQRCode stellarAddress={mockStellarAddress} campaignTitle={mockCampaignTitle} />
    );

    const canvas = container.querySelector('canvas');
    if (canvas) {
      canvas.toBlob = mockToBlob;
    }

    const downloadButton = screen.getByRole('button', { name: /Download QR code as PNG/i });
    await user.click(downloadButton);

    expect(mockToBlob).toHaveBeenCalled();
    expect(global.URL.createObjectURL).toHaveBeenCalledWith(mockBlob);
  });

  it('handles case when canvas is not found gracefully', async () => {
    const user = userEvent.setup();
    render(<DonationQRCode stellarAddress={mockStellarAddress} campaignTitle={mockCampaignTitle} />);

    const downloadButton = screen.getByRole('button', { name: /Download QR code as PNG/i });
    
    // Should not throw error even if canvas methods fail
    await user.click(downloadButton);
  });

  it('applies correct styling classes', () => {
    const { container } = render(
      <DonationQRCode stellarAddress={mockStellarAddress} campaignTitle={mockCampaignTitle} />
    );

    expect(container.querySelector('.qr-code-container')).toBeInTheDocument();
    expect(container.querySelector('.qr-code-header')).toBeInTheDocument();
    expect(container.querySelector('.qr-code-wrapper')).toBeInTheDocument();
    expect(container.querySelector('.qr-code-address')).toBeInTheDocument();
    expect(container.querySelector('.qr-download-btn')).toBeInTheDocument();
  });

  it('downloads file with correct name', async () => {
    const user = userEvent.setup();
    const mockBlob = new Blob(['fake-image-data'], { type: 'image/png' });
    const mockClick = vi.fn();

    // Create a mock link element
    const mockLink = document.createElement('a');
    mockLink.click = mockClick;

    vi.spyOn(document, 'createElement').mockReturnValue(mockLink);

    const { container } = render(
      <DonationQRCode stellarAddress={mockStellarAddress} campaignTitle={mockCampaignTitle} />
    );

    const canvas = container.querySelector('canvas');
    if (canvas) {
      canvas.toBlob = vi.fn((callback) => {
        callback(mockBlob);
      });
    }

    const downloadButton = screen.getByRole('button', { name: /Download QR code as PNG/i });
    await user.click(downloadButton);

    expect(mockLink.download).toBe('campaign_donate_qr.png');
    expect(mockClick).toHaveBeenCalled();

    vi.restoreAllMocks();
  });

  it('regenerates QR code when stellar address changes', async () => {
    vi.clearAllMocks();
    
    const { rerender } = render(
      <DonationQRCode stellarAddress={mockStellarAddress} campaignTitle={mockCampaignTitle} />
    );

    const initialCallCount = vi.mocked(QRCode.toCanvas).mock.calls.length;
    const newAddress = 'GBVB43NLVIP2USHXSKI7QQCZKJCD6ZZWRIORS2IBYYTPWLVPG3HFPQHC';
    
    rerender(<DonationQRCode stellarAddress={newAddress} campaignTitle={mockCampaignTitle} />);

    await waitFor(() => {
      expect(vi.mocked(QRCode.toCanvas).mock.calls.length).toBeGreaterThan(initialCallCount);
    });
  });
});
