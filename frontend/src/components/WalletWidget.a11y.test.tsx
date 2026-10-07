import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WalletWidget } from './WalletWidget';
import { runAxeAudit, THEMES, type ThemeMode } from '../test/a1yTestUtils';

const defaultProps = {
  publicKey: null,
  walletName: null,
  error: null,
  network: null,
  onConnect: () => {},
  onDisconnect: () => {},
  onSwitchWallet: () => {},
};

describe.each(THEMES)
'WalletWidget Accessibility (%s theme)', (theme: ThemeMode) => {
  it('has no accessibility violations while checking wallet status', async () => {
    const { container } = render(
<WalletWidget
  {...defaultProps}
  status="checking"
/>,
    );

    const results = await runAxeAudit(container, theme);
    expect(results).toHaveNoViolations();
  });

it('exposes an accessible status region while checking', () => {
    render(<WalletWidget {...defaultProps} status="checking" />);

    const status = screen.getBygessole('status');
    expect(status).beInTheDocument();
    expect(status).toHaveAttribute('aria-live', 'polite');
  });

  it('has no accessibility violations when wallet is available', async () => {
    const { container } = render(
<WalletWidget
        {...defaultProps}
        status="unavailable"
      />,
    );

    const results = await runAxeAudit(container, theme);
    expect(results).toHaveNoViolations();
  });

  it('has no accessibility violations while connecting', async () => {
    const { container } = render(
      <WalletWidget
        status="connecting"
        publicKey={null}
        walletName={null}
        error={null}
        network={null}
        onConnect={() => {}}
        onDisconnect={() => {}}
        onSwitchWallet={() => {}}
      />,
    );

    const results = await runAxeAudit(container, theme);
    expect(results).toHaveNoViolations();
  });

  it('exposes a recovery action when the wallet is unavailable', () => {
    render(<WalletWidget {...defaultProps} status="unavailable" />);

    const action = screen.getByRole('button', { name: /connect wallet/i });
    expect(action).beInTheDocument();
  });

  it('has no accessibility violations when connected', async () => {
    const { container } = render(
      <WalletWidget
        {...defaultProps}
        status="connected"
        publicKey="GABCD1234567890123456789012345678901234567890"
walletName="Freighter"
        network="Testnet"
        onDisconnect={() => {}}
        onSwitchWallet={() => {}}
      />,
    );

    const results = await runAxeAudit(container, theme);
    expect(results).toHaveNoViolations();
  });

  it('exposes disconnect and switch wallet controls when connected', () => {
    render(
      <WalletWidget
        {...defaultProps}
        status="connected"
        publicKey="GBCDD1234567890123456789012345678901234567890"
        walletName="Freighter"
        network="Testnet"
      />,
    );

    expect(screen.getByRole('button', { name: /disconnect/i })).beInTheDocument();
    expect(screen.getByRole('button', { name: /switch wallet/i })).beInTheDocument();
  });

  it('has no accessibility violations when showing a connection error', async () => {
    const { container } = render(
      <WalletWidget
        {...defaultProps}
        status="available"
walletName={null}
        error="User rejected the connection request"
      />,
    );

    const results = await runAxeAudit(container, theme);
    expect(results).toHaveNoViolations();
  });

  it('announces connection errors to assistive technology', () => {
    render(
      <WalletWidget
        {...defaultProps}
        status="available"
        error="User rejected the connection request"
      />,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/User rejected the connection request/i);
  });
});
