import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { SearchInput } from './SearchInput';

const meta: Meta<typeof SearchInput> = {
  title: 'Components/SearchInput',
  component: SearchInput,
  parameters: { layout: 'padded' },
  args: {
    value: '',
    onChange: () => {},
    placeholder: 'Search campaigns...',
  },
};

export default meta;
type Story = StoryObj<typeof SearchInput>;

export const Empty: Story = {};

export const WithValue: Story = {
  args: { value: 'stellar hub' },
};

export const Disabled: Story = {
  args: { disabled: true, value: '' },
};

export const Interactive: Story = {
  render: (args) => {
    const [value, setValue] = useState('');
    return <SearchInput {...args} value={value} onChange={setValue} />;
  },
};
