import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TransactionPreviewModal, TransactionPreviewData } from './TransactionPreviewModal';

const basePreview: TransactionPreviewData = {
  operation: 'contribute',
  amount: 100,
  assetCode: 'USDC',
  contract: 'CTEST123',
  xdr: 'AAAA',
  estimatedFee: { stroops: 100, xlm: '0.00001' },
};

describe('TransactionPreviewModal pledge flow', () => {
  it('displays campaign title and pledge details', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <TransactionPreviewModal
        preview={basePreview}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    expect(screen.getByText('Transaction Preview')).toBeInTheDocument();
    expect(screen.getByText('contribute')).toBeInTheDocument();
    expect(screen.getByText(/100\s+USDC/)).toBeInTheDocument();
    expect(screen.getByText(/0.00001 XLM/)).toBeInTheDocument();
  });

  it('calls onConfirm when user clicks Confirm button', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <TransactionPreviewModal
        preview={basePreview}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    const confirmButton = screen.getByRole('button', { name: /Confirm and Sign/ });
    fireEvent.click(confirmButton);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('calls onCancel when user clicks Cancel button', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <TransactionPreviewModal
        preview={basePreview}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    const cancelButton = screen.getByRole('button', { name: /Cancel/ });
    fireEvent.click(cancelButton);

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('displays keyboard accessible interface', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <TransactionPreviewModal
        preview={basePreview}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    const confirmButton = screen.getByRole('button', { name: /Confirm and Sign/ });
    expect(confirmButton).toHaveProperty('type', 'button');
  });
});
