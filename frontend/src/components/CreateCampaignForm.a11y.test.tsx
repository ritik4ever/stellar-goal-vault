import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { CreateCampaignForm } from './CreateCampaignForm';
import { runAxeAudit, THEMES, type ThemeMode } from '../test/a11yTestUtils';

async function fillBasicsAndAdvance(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByPlaceholderText(/G\.\.\. creator public key/i), 'G' + 'A'.repeat(55));
  await user.type(
    screen.getByPlaceholderText(/Stellar community design sprint/i),
    'My Test Campaign',
  );
  await user.type(
    screen.getByPlaceholderText(/Describe what the campaign funds/i),
    'This campaign funds a real Soroban pledge flow for the MVP dashboard.',
  );
  await user.selectOptions(screen.getByRole('combobox'), 'Community');
  await user.click(screen.getByRole('button', { name: /^next$/i }));
}

describe.each(THEMES)('CreateCampaignForm Accessibility (%s theme)', (theme: ThemeMode) => {
  it('exposes named form controls and moves focus to each new step', async () => {
    const user = userEvent.setup();
    render(<CreateCampaignForm onCreate={async () => {}} allowedAssets={['USDC', 'XLM']} />);

    expect(screen.getByRole('form', { name: /basics/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/creator account/i)).toBeInTheDocument();

    await fillBasicsAndAdvance(user);

    expect(screen.getByRole('heading', { name: 'Funding' })).toHaveFocus();
    expect(screen.getByRole('group', { name: /accepted tokens/i })).toBeInTheDocument();
  });

  it('associates validation messages with invalid controls', async () => {
    const user = userEvent.setup();
    render(<CreateCampaignForm onCreate={async () => {}} />);

    await user.click(screen.getByRole('button', { name: /^next$/i }));

    const creator = screen.getByLabelText(/creator account/i);
    expect(creator).toHaveAttribute('aria-invalid', 'true');
    expect(creator).toHaveAttribute('aria-describedby', 'creator-error');
    expect(screen.getByText('Creator account is required')).toHaveAttribute('id', 'creator-error');
  });

  it('has no accessibility violations on the Basics step', async () => {
    const { container } = render(
      <CreateCampaignForm onCreate={async () => {}} allowedAssets={['USDC', 'XLM']} />,
    );

    const results = await runAxeAudit(container, theme);
    expect(results).toHaveNoViolations();
  });

  it('has no accessibility violations on the Funding step', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <CreateCampaignForm onCreate={async () => {}} allowedAssets={['USDC', 'XLM']} />,
    );

    await fillBasicsAndAdvance(user);

    const results = await runAxeAudit(container, theme);
    expect(results).toHaveNoViolations();
  });

  it('has no accessibility violations on the Rewards step with a tier added', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <CreateCampaignForm onCreate={async () => {}} allowedAssets={['USDC', 'XLM']} />,
    );

    await fillBasicsAndAdvance(user);
    await user.click(screen.getByRole('button', { name: /^next$/i }));
    await user.click(screen.getByRole('button', { name: /add reward tier/i }));

    const results = await runAxeAudit(container, theme);
    expect(results).toHaveNoViolations();
  });

  it('has no accessibility violations on the Review step, including API errors', async () => {
    const user = userEvent.setup();
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

    await fillBasicsAndAdvance(user);
    await user.click(screen.getByRole('button', { name: /^next$/i }));
    await user.click(screen.getByRole('button', { name: /^next$/i }));

    const results = await runAxeAudit(container, theme);
    expect(results).toHaveNoViolations();
  });
});
