import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WalletWidget } from './WalletWidget';
import { runAxeAudit, THEMES, type ThemeMode } from '../test/a11yTestUtils';

describe.each(THEMES)('WalletWidget Accessibility (%s theme)', (theme: ThemeMode) => {
  it('has no accessibility violations while checking wallet status', async () => {
    const { container } = render(
      <WalletWidget
        status="checking"
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

  it('has no accessibility violations when wallet is available', async () => {
    const { container } = render(
      <WalletWidget
        status="available"
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

  it('has no accessibility violations when connected', async () => {
    const { container } = render(
      <WalletWidget
        status="connected"
        publicKey="GABCD1234567890123456789012345678901234567890"
        walletName="Freighter"
        error={null}
        network="Testnet"
        onConnect={() => {}}
        onDisconnect={() => {}}
        onSwitchWallet={() => {}}
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
        walletName={null}
        error="User rejected the connection request"
        network={null}
        onConnect={() => {}}
        onDisconnect={() => {}}
        onSwitchWallet={() => {}}
      />,
    );

    const results = await runAxeAudit(container, theme);
    expect(results).toHaveNoViolations();
  });

  it('has no accessibility violations when connected on mainnet', async () => {
    const { container } = render(
      <WalletWidget
        status="connected"
        publicKey="GABCD1234567890123456789012345678901234567890"
        walletName="Freighter"
        error={null}
        network="Mainnet"
        onConnect={() => {}}
        onDisconnect={() => {}}
        onSwitchWallet={() => {}}
      />,
    );

    const results = await runAxeAudit(container, theme);
    expect(results).toHaveNoViolations();
  });

  it('has no accessibility violations when connected without network info', async () => {
    const { container } = render(
      <WalletWidget
        status="connected"
        publicKey="GABCD1234567890123456789012345678901234567890"
        walletName="Freighter"
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
});
