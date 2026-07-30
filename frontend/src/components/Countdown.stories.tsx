import type { Meta, StoryObj } from '@storybook/react-vite';
import { Countdown } from './Countdown';

const meta: Meta<typeof Countdown> = {
  title: 'Components/Countdown',
  component: Countdown,
  parameters: { layout: 'padded' },
  args: {
    hoursLeft: 168,
  },
};

export default meta;
type Story = StoryObj<typeof Countdown>;

export const Default: Story = {};
export const LessThanDay: Story = {
  args: { hoursLeft: 12 },
};
export const Ended: Story = {
  args: { hoursLeft: 0 },
};
export const Week: Story = {
  args: { hoursLeft: 168 },
};
export const Month: Story = {
  args: { hoursLeft: 720 },
};
