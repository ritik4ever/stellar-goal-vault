import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CreateCampaignForm } from './CreateCampaignForm';
import { runAxeAudit, THEMES, type ThemeMode } from '../test/a11yTestUtils';

describe.each(THEMES)('CreateCampaignForm Accessibility (%s theme)', (theme: ThemeMode) => {
  it('has no accessibility violations', async () => {
    const { container } = render(
      <CreateCampaignForm onCreate={async () => {}} allowedAssets={['USDC', 'XLM']} />,
    );

    const results = await runAxeAudit(container, theme);
    expect(results).toHaveNoViolations();
  });

  it('has no accessibility violations when showing API errors', async () => {
    const { container } = render(
      <CreateCampaignForm
        onCreate={async () => {}}
        allowedAssets={['USDC', 'XLM']}
        apiError={{
          message: 'Unable to create campaign',
          code: 'VALIDATION_FAILED',
          details: [{ field: 'title', message: 'Title is too short' }],
        }}
      />,
    );

    const results = await runAxeAudit(container, theme);
    expect(results).toHaveNoViolations();
  });
});
