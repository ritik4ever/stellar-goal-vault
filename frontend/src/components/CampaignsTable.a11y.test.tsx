import { render } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { CampaignsTable } from './CampaignsTable';

describe('CampaignsTable Accessibility', () => {
  it('should have no critical accessibility violations in an empty state', async () => {
    const { container } = render(
      <CampaignsTable 
        campaigns={[]} 
        selectedCampaignId={null} 
        onSelect={() => {}} 
      />
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('should have no critical accessibility violations with data', async () => {
    const mockCampaigns = [
      {
        id: "1",
        creator: "GABCD123456789",
        title: "Test Campaign",
        description: "Test description",
        assetCode: "USDC",
        targetAmount: 1000,
        pledgedAmount: 500,
        deadline: Math.floor(Date.now() / 1000) + 3600,
        progress: { status: "open", percentFunded: 50, hoursLeft: 1 }
      }
    ];

    const { container } = render(
      <CampaignsTable 
        // @ts-ignore - bypassing full mock type strictness for testing DOM structure
        campaigns={mockCampaigns} 
        selectedCampaignId={null} 
        onSelect={() => {}} 
      />
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});