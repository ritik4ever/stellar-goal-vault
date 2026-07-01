import type { Meta, StoryObj } from '@storybook/react-vite';
import { ToastContainer } from './ToastContainer';
import type { Toast } from '../hooks/useToast';

const successToast: Toast = { id: '1', message: 'Campaign created successfully!', variant: 'success' };
const errorToast: Toast = { id: '2', message: 'Failed to submit pledge. Please try again.', variant: 'error' };
const infoToast: Toast = { id: '3', message: 'Transaction is being processed on-chain.', variant: 'info' };

const meta: Meta<typeof ToastContainer> = {
  title: 'Components/ToastContainer',
  component: ToastContainer,
  parameters: { layout: 'padded' },
  args: {
    toasts: [successToast],
    onDismiss: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof ToastContainer>;

export const Success: Story = {};

export const Error: Story = {
  args: { toasts: [errorToast] },
};

export const Info: Story = {
  args: { toasts: [infoToast] },
};

export const Multiple: Story = {
  args: { toasts: [successToast, errorToast, infoToast] },
};

export const Empty: Story = {
  args: { toasts: [] },
};
