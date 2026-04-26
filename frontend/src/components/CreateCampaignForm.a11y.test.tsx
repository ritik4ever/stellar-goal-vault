import { render } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { CreateCampaignForm } from './CreateCampaignForm';

describe('CreateCampaignForm Accessibility', () => {
  it('should have no critical accessibility violations', async () => {
    // Render the component with placeholder props
    const { container } = render(
      <CreateCampaignForm 
        onCreate={async () => {}} 
        allowedAssets={['USDC', 'XLM']} 
      />
    );

    // Run axe-core against the rendered DOM
    const results = await axe(container);
    
    // Assert no violations
    expect(results).toHaveNoViolations();
  });
});