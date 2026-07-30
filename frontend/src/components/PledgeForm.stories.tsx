import type { Meta, StoryObj } from '@storybook/react-vite';
import { PledgeForm } from './PledgeForm';
import type { Campaign } from '../types/campaign';

const baseCampaign: Campaign = {
  id: 'camp-001',
  creator: 'GBEZH6T5V7VHUWGMAHVICBFV7WSNULSIHHMV7B2LFNJA6J3XVMT7M2LVY',
  title: 'Stellar Community Hub',
  description: 'Building a community hub for Stellar developers.',
  acceptedTokens: ['XLM'],
  assetCode: 'XLM',
  targetAmount: 10000,
  pledgedAmount: 6500,
  deadline: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7,
  createdAt: Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 3,
  progress: {
    status: 'open',
    percentFunded: 65,
    remainingAmount: 3500,
    pledgeCount: 12,
    hoursLeft: 168,
    canPledge: true,
    canClaim: false,
    canRefund: false,
  },
};

const meta: Meta<typeof PledgeForm> = {
  title: 'Components/PledgeForm',
  component: PledgeForm,
  parameters: { layout: 'padded' },
  args: {
    campaign: baseCampaign,
    connectedWallet: 'GBEZH6T5V7VHUWGMAHVICBFV7WSNULSIHHMV7B2LFNJA6J3XVMT7M2LVY',
    isSubmitting: false,
    isPledgePending: false,
    pledgeError: null,
    acceptedTokens: ['XLM'],
    onPledge: async () => {},
    onClaim: async () => {},
    onRefund: async () => {},
    onDisconnectWallet: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof PledgeForm>;

export const Default: Story = {};
export const WalletDisconnected: Story = {
  args: { connectedWallet: null },
};
export const PledgePending: Story = {
  args: { isPledgePending: true },
};
export const PledgeError: Story = {
  args: { pledgeError: 'Insufficient balance' },
};
export const MultiToken: Story = {
  args: {
    campaign: { ...baseCampaign, acceptedTokens: ['XLM', 'USDC'] },
    acceptedTokens: ['XLM', 'USDC'],
  },
};
export const Claimable: Story = {
  args: {
    campaign: {
      ...baseCampaign,
      progress: { ...baseCampaign.progress, canClaim: true, canPledge: false },
    },
    connectedWallet: 'GBEZH6T5V7VHUWGMAHVICBFV7WSNULSIHHMV7B2LFNJA6J3XVMT7M2LVY',
  },
};
