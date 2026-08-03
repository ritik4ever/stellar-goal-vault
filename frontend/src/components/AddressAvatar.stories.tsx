import type { Meta, StoryObj } from '@storybook/react-vite';
import { AddressAvatar } from './AddressAvatar';

const meta: Meta<typeof AddressAvatar> = {
  title: 'Components/AddressAvatar',
  component: AddressAvatar,
  parameters: { layout: 'centered' },
  args: {
    address: 'GBEZH6T5V7VHUWGMAHVICBFV7WSNULSIHHMV7B2LFNJA6J3XVMT7M2LVY',
    size: 40,
  },
};

export default meta;
type Story = StoryObj<typeof AddressAvatar>;

export const Default: Story = {};

export const Small: Story = {
  args: { size: 24 },
};

export const Large: Story = {
  args: { size: 64 },
};

export const DifferentAddresses: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      {[
        'GBEZH6T5V7VHUWGMAHVICBFV7WSNULSIHHMV7B2LFNJA6J3XVMT7M2LVY',
        'GABC123DEF456GHI789JKL012MNO345PQR678STU901VWX234YZA567BCD',
        'GCDE890FGH123IJK456LMN789OPQ012RST345UVW678XYZ901ABC234DEF',
        'GFGH567IJK890LMN123OPQ456RST789UVW012XYZ345ABC678DEF901GHI',
      ].map((addr) => (
        <AddressAvatar key={addr} address={addr} size={40} />
      ))}
    </div>
  ),
};
