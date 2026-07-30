import type { Meta, StoryObj } from '@storybook/react-vite';

function DesignTokens() {
  return null;
}

interface TokenRowProps {
  name: string;
  value: string;
  usage: string;
}

function TokenRow({ name, value, usage }: TokenRowProps) {
  return (
    <tr>
      <td style={{ padding: 8, borderBottom: '1px solid #1e293b' }}><code>{name}</code></td>
      <td style={{ padding: 8, borderBottom: '1px solid #1e293b' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              width: 20,
              height: 20,
              borderRadius: 4,
              background: value,
              display: 'inline-block',
              border: '1px solid #475569',
            }}
          />
          {value}
        </span>
      </td>
      <td style={{ padding: 8, borderBottom: '1px solid #1e293b' }}>{usage}</td>
    </tr>
  );
}

const meta: Meta<typeof DesignTokens> = {
  title: 'Docs/Design Tokens',
  parameters: {
    docs: { description: { component: 'Design tokens used across the Stellar Goal Vault frontend.' } },
  },
};

export default meta;
type Story = StoryObj<typeof DesignTokens>;

export const Colors: Story = {
  render: () => (
    <div style={{ padding: 24, maxWidth: 900 }}>
      <h3 style={{ margin: '0 0 16px', fontSize: '1.1rem', fontWeight: 600 }}>Color Tokens</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: 8, borderBottom: '2px solid #334155' }}>Token</th>
            <th style={{ textAlign: 'left', padding: 8, borderBottom: '2px solid #334155' }}>Value</th>
            <th style={{ textAlign: 'left', padding: 8, borderBottom: '2px solid #334155' }}>Usage</th>
          </tr>
        </thead>
        <tbody>
          <TokenRow name="--primary" value="#6366f1" usage="Primary actions and accents" />
          <TokenRow name="--secondary" value="#a855f7" usage="Secondary actions" />
          <TokenRow name="--accent" value="#f43f5e" usage="Destructive and highlight actions" />
          <TokenRow name="--bg-deep" value="#0f172a" usage="Main page background" />
          <TokenRow name="--bg-surface" value="rgba(30, 41, 59, 0.7)" usage="Card backgrounds" />
          <TokenRow name="--text-main" value="#f8fafc" usage="Primary text color" />
          <TokenRow name="--text-muted" value="#94a3b8" usage="Secondary text" />
          <TokenRow name="--badge-open-text" value="#c7d2fe" usage="Open status badge text" />
          <TokenRow name="--badge-funded-text" value="#86efac" usage="Funded status badge text" />
        </tbody>
      </table>

      <h3 style={{ margin: '32px 0 16px', fontSize: '1.1rem', fontWeight: 600 }}>Radii</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: 8, borderBottom: '2px solid #334155' }}>Token</th>
            <th style={{ textAlign: 'left', padding: 8, borderBottom: '2px solid #334155' }}>Value</th>
            <th style={{ textAlign: 'left', padding: 8, borderBottom: '2px solid #334155' }}>Usage</th>
          </tr>
        </thead>
        <tbody>
          <TokenRow name="--radius-xl" value="24px" usage="Cards and panels" />
          <TokenRow name="--radius-lg" value="16px" usage="Image containers" />
          <TokenRow name="--radius-md" value="12px" usage="Buttons, inputs, badges" />
        </tbody>
      </table>

      <h3 style={{ margin: '32px 0 16px', fontSize: '1.1rem', fontWeight: 600 }}>Typography</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: 8, borderBottom: '2px solid #334155' }}>Token</th>
            <th style={{ textAlign: 'left', padding: 8, borderBottom: '2px solid #334155' }}>Value</th>
            <th style={{ textAlign: 'left', padding: 8, borderBottom: '2px solid #334155' }}>Usage</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={{ padding: 8, borderBottom: '1px solid #1e293b' }}><code>font-family: Outfit</code></td>
            <td style={{ padding: 8, borderBottom: '1px solid #1e293b' }}>Google Font import</td>
            <td style={{ padding: 8, borderBottom: '1px solid #1e293b' }}>Global UI font</td>
          </tr>
          <tr>
            <td style={{ padding: 8, borderBottom: '1px solid #1e293b' }}><code>--font-mono</code></td>
            <td style={{ padding: 8, borderBottom: '1px solid #1e293b' }}>ui-monospace, SFMono-Regular, Menlo, Consolas, monospace</td>
            <td style={{ padding: 8, borderBottom: '1px solid #1e293b' }}>Addresses and code</td>
          </tr>
        </tbody>
      </table>
    </div>
  ),
};
