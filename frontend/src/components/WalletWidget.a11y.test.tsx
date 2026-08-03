import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WalletWidget } from './WalletWidget';
import { runAxeAudit, THEMES, type ThemeMode } from '../test/a11yTestUtils';

describe.each(THEMES)('WalletWidget Accessibility (%s theme)', (theme: ThemeMode) => {
  it('has no accessibility violations while checking wallet status', async () => {
    const { container } = render(
      <WalletWidget status="checking" publicKey={null} error={null} onConnect={() => {}} />,
    );

    const results = await runAxeAudit(container, theme);
    expect(results).toHaveNoViolations();
  });

  it('has no accessibility violations when Freighter is unavailable', async () => {
    const { container } = render(
      <WalletWidget status="unavailable" publicKey={null} error={null} onConnect={() => {}} />,
    );

    const results = await runAxeAudit(container, theme);
    expect(results).toHaveNoViolations();
  });

  it('has no accessibility violations when connected', async () => {
    const { container } = render(
      <WalletWidget
        status="connected"
        publicKey="GABCD1234567890123456789012345678901234567890"
        error={null}
        onConnect={() => {}}
      />,
    );

    const results = await runAxeAudit(container, theme);
    expect(results).toHaveNoViolations();
  });

  it('has no accessibility violations when showing a connection error', async () => {
    const { container } = render(
      <WalletWidget
        status="available"
        publicKey={null}
        error="User rejected the connection request"
        onConnect={() => {}}
      />,
    );

    const results = await runAxeAudit(container, theme);
    expect(results).toHaveNoViolations();
  });
});
