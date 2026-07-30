import type { Meta, StoryObj } from '@storybook/react-vite';
import { FundingProgress } from './FundingProgress';

const meta: Meta<typeof FundingProgress> = {
  title: 'Components/FundingProgress',
  component: FundingProgress,
  parameters: { layout: 'padded' },
  args: {
    percentFunded: 65,
    pledgedAmount: 6500,
    targetAmount: 10000,
    assetCode: 'XLM',
  },
};

export default meta;
type Story = StoryObj<typeof FundingProgress>;

export const Default: Story = {};
export const Empty: Story = {
  args: { percentFunded: 0, pledgedAmount: 0, targetAmount: 10000, assetCode: 'XLM' },
};
export const Half: Story = {
  args: { percentFunded: 50, pledgedAmount: 5000, targetAmount: 10000, assetCode: 'XLM' },
};
export const Funded: Story = {
  args: { percentFunded: 100, pledgedAmount: 10000, targetAmount: 10000, assetCode: 'XLM' },
};
export const Overfunded: Story = {
  args: { percentFunded: 120, pledgedAmount: 12000, targetAmount: 10000, assetCode: 'XLM' },
};
export const MultiToken: Story = {
  args: {
    percentFunded: 45,
    pledgedAmount: 4500,
    targetAmount: 10000,
    assetCode: 'XLM',
    acceptedTokens: ['XLM', 'USDC'],
    tokenBalances: { XLM: 3000, USDC: 1500 },
  },
};
