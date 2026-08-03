import type { Meta, StoryObj } from '@storybook/react';
import { DonationQRCode } from './DonationQRCode';

const meta: Meta<typeof DonationQRCode> = {
  title: 'Components/DonationQRCode',
  component: DonationQRCode,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    stellarAddress: {
      control: 'text',
      description: 'The Stellar address to encode in the QR code',
    },
    campaignTitle: {
      control: 'text',
      description: 'The title of the campaign',
    },
  },
};

export default meta;
type Story = StoryObj<typeof DonationQRCode>;

export const Default: Story = {
  args: {
    stellarAddress: 'GDJX5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z',
    campaignTitle: 'Save the Ocean',
  },
};

export const LongAddress: Story = {
  args: {
    stellarAddress: 'GDJX5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z',
    campaignTitle: 'Community Garden Project',
  },
};

export const ShortCampaignTitle: Story = {
  args: {
    stellarAddress: 'GBVB43NLVIP2USHXSKI7QQCZKJCD6ZZWRIORS2IBYYTPWLVPG3HFPQHC',
    campaignTitle: 'Help',
  },
};

export const RealStellarAddress: Story = {
  args: {
    stellarAddress: 'GBVB43NLVIP2USHXSKI7QQCZKJCD6ZZWRIORS2IBYYTPWLVPG3HFPQHC',
    campaignTitle: 'Stellar Development Fund',
  },
  parameters: {
    docs: {
      description: {
        story: 'This example uses a real-looking Stellar address format that can be scanned by wallets like Lobstr and Solar.',
      },
    },
  },
};
