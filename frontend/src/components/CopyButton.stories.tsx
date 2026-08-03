import type { Meta, StoryObj } from '@storybook/react-vite';
import { CopyButton } from './CopyButton';

const meta: Meta<typeof CopyButton> = {
  title: 'Components/CopyButton',
  component: CopyButton,
  parameters: { layout: 'centered' },
  args: {
    value: 'GBEZH6T5V7VHUWGMAHVICBFV7WSNULSIHHMV7B2LFNJA6J3XVMT7M2LVY',
    ariaLabel: 'Copy address',
  },
};

export default meta;
type Story = StoryObj<typeof CopyButton>;

export const Default: Story = {};

export const SmallVariant: Story = {
  args: { className: 'small' },
};

export const CustomLabel: Story = {
  args: {
    value: 'some-transaction-hash-abc123',
    ariaLabel: 'Copy transaction hash',
  },
};
