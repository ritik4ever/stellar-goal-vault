import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { DonationQRCode } from './DonationQRCode';

describe('DonationQRCode Accessibility', () => {
  const mockStellarAddress = 'GDJX5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z';
  const mockCampaignTitle = 'Test Campaign';

  it('should not have accessibility violations', async () => {
    const { container } = render(
      <DonationQRCode stellarAddress={mockStellarAddress} campaignTitle={mockCampaignTitle} />
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('has proper ARIA label on download button', () => {
    const { getByRole } = render(
      <DonationQRCode stellarAddress={mockStellarAddress} campaignTitle={mockCampaignTitle} />
    );

    const downloadButton = getByRole('button', { name: /Download QR code as PNG/i });
    expect(downloadButton).toHaveAttribute('aria-label', 'Download QR code as PNG');
  });

  it('has proper heading hierarchy', () => {
    const { container } = render(
      <DonationQRCode stellarAddress={mockStellarAddress} campaignTitle={mockCampaignTitle} />
    );

    const heading = container.querySelector('h3');
    expect(heading).toBeInTheDocument();
    expect(heading?.textContent).toBe('Scan to Donate');
  });
});
