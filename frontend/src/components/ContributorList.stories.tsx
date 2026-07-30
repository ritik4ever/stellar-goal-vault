import type { Meta, StoryObj } from '@storybook/react-vite';
import { ContributorList } from './ContributorList';
import type { ContributorSummary } from '../types/campaign';

const baseContributors: ContributorSummary[] = [
  {
    contributor: 'GBEZH6T5V7VHUWGMAHVICBFV7WSNULSIHHMV7B2LFNJA6J3XVMT7M2LVY',
    totalPledged: 2500,
    refundedAmount: 0,
    isFullyRefunded: false,
  },
  {
    contributor: 'GABCD1234EFGH5678IJKL9012MNOP3456QRST7890',
    totalPledged: 1500,
    refundedAmount: 1500,
    isFullyRefunded: true,
  },
];

const meta: Meta<typeof ContributorList> = {
  title: 'Components/ContributorList',
  component: ContributorList,
  parameters: { layout: 'padded' },
  args: {
    contributors: baseContributors,
    assetCode: 'XLM',
  },
};

export default meta;
type Story = StoryObj<typeof ContributorList>;

export const Default: Story = {};
export const Empty: Story = {
  args: { contributors: [] },
};
export const PartialRefund: Story = {
  args: {
    contributors: [
      ...baseContributors,
      {
        contributor: 'GDEF9012MNOP3456QRST7890ABCD1234EFGH5678',
        totalPledged: 3000,
        refundedAmount: 1000,
        isFullyRefunded: false,
      },
    ],
  },
};
