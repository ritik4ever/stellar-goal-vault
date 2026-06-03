import type { Meta, StoryObj } from '@storybook/react-vite';
import { CampaignCard } from './CampaignCard';
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

const meta: Meta<typeof CampaignCard> = {
  title: 'Components/CampaignCard',
  component: CampaignCard,
  parameters: { layout: 'padded' },
  args: {
    campaign: baseCampaign,
    selectedCampaignId: null,
    onSelect: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof CampaignCard>;

export const Default: Story = {};

export const Selected: Story = {
  args: { selectedCampaignId: 'camp-001' },
};

export const Funded: Story = {
  args: {
    campaign: {
      ...baseCampaign,
      pledgedAmount: 10000,
      progress: { ...baseCampaign.progress, status: 'funded', percentFunded: 100, canClaim: true, canPledge: false },
    },
  },
};

export const Failed: Story = {
  args: {
    campaign: {
      ...baseCampaign,
      pledgedAmount: 2000,
      deadline: Math.floor(Date.now() / 1000) - 3600,
      progress: { ...baseCampaign.progress, status: 'failed', percentFunded: 20, canRefund: true, canPledge: false, hoursLeft: 0 },
    },
  },
};

export const Claimed: Story = {
  args: {
    campaign: {
      ...baseCampaign,
      pledgedAmount: 10000,
      claimedAt: Math.floor(Date.now() / 1000) - 3600,
      progress: { ...baseCampaign.progress, status: 'claimed', percentFunded: 100, canPledge: false },
    },
  },
};

export const MultiToken: Story = {
  args: {
    campaign: {
      ...baseCampaign,
      acceptedTokens: ['XLM', 'USDC'],
      progress: { ...baseCampaign.progress, percentFunded: 45 },
    },
  },
};
