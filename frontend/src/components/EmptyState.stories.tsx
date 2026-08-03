import type { Meta, StoryObj } from '@storybook/react-vite';
import { Search, Inbox, AlertCircle } from 'lucide-react';
import { EmptyState } from './EmptyState';

const meta: Meta<typeof EmptyState> = {
  title: 'Components/EmptyState',
  component: EmptyState,
  parameters: { layout: 'centered' },
  args: {
    message: 'No campaigns found.',
  },
};

export default meta;
type Story = StoryObj<typeof EmptyState>;

export const Default: Story = {};

export const WithTitle: Story = {
  args: {
    title: 'Nothing here yet',
    message: 'Create your first campaign to get started.',
  },
};

export const WithIcon: Story = {
  args: {
    title: 'No results',
    message: 'Try adjusting your search or filters.',
    icon: Search,
  },
};

export const CardVariant: Story = {
  args: {
    title: 'Empty inbox',
    message: 'You have no pending notifications.',
    icon: Inbox,
    variant: 'card',
  },
};

export const ErrorState: Story = {
  args: {
    title: 'Something went wrong',
    message: 'Unable to load campaigns. Please try again.',
    icon: AlertCircle,
    variant: 'card',
  },
};
