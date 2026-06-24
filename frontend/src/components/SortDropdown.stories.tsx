import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { SortDropdown, type SortOption } from './SortDropdown';

const meta: Meta<typeof SortDropdown> = {
  title: 'Components/SortDropdown',
  component: SortDropdown,
  parameters: { layout: 'centered' },
  args: {
    value: 'newest',
    onChange: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof SortDropdown>;

export const Default: Story = {};

export const ByDeadline: Story = {
  args: { value: 'deadline' },
};

export const ByPercentFunded: Story = {
  args: { value: 'percentFunded' },
};

export const Disabled: Story = {
  args: { disabled: true },
};

export const Interactive: Story = {
  render: (args) => {
    const [value, setValue] = useState<SortOption>('newest');
    return <SortDropdown {...args} value={value} onChange={setValue} />;
  },
};
