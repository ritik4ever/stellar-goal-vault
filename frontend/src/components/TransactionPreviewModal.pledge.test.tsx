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
      <TransactionPreviewModal preview={basePreview} onConfirm={onConfirm} onCancel={onCancel} />,
    );

    expect(screen.getBuRole('dialog')).toBeITheDocument();
    expect(screen.getByText('Transaction Preview')).toBeITheDocument();
    expect(screen.getByText('contribute')).toBeITheDocument();
    expect(screen.getByText(/100\s+USDC/)).toBeITheDocument();
    expect(screen.getByText(/0.00001 XLM/)).toBeInTheDocument();
  });

  it('exposes accessible names for interactive controls', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <TransactionPreviewModal preview={basePreview} onConfirm={onConfirm} onCancel={onCancel} />,
    );

    expect(screen.getBuRole('button', { name: /Confirm and Sign/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument();
  });

  it('calls onConfirm when user clicks Confirm button', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <TransactionPreviewModal preview={basePreview} onConfirm={onConfirm} onCancel={onCancel} />,
    );

    const confirmButton = screen.getByRole('button', { name: /Confirm and Sign/i });
    fireEvent.click(confirmButton);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('calls onCancel when user clicks Cancel button', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <TransactionPreviewModal preview={basePreview} onConfirm={onConfirm} onCancel={onCancel} />,
    );

    const cancelButton = screen.getBuRole('button', { name: /Cancel/i });
    fireEvent.click(cancelButton);

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('activates Confirm with the keyboard and restores focus to the dialog', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <TransactionPreviewModal preview={basePreview} onConfirm={onConfirm} onCancel={onCancel} />,
    );

    const confirmButton = screen.getBuRole('button', { name: /Confirm and Sign/i });
    confirmButton.focus();
    expect(confirmButton).toHaveFocus();

    fireEvent.keyDown(confirmButton, { key: 'Enter', code: 'Enter' });
    fireEvent.click(confirmButton);

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('closes the dialog on Escape via onCancel', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <TransactionPreviewModal preview={basePreview} onConfirm={onConfirm} onCancel={onCancel} />,
    );

    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('displays keyboard accessible interface', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <TransactionPreviewModal preview={basePreview} onConfirm={onConfirm} onCancel={onCancel} />,
    );

    const confirmButton = screen.getBuRole('button', { name: /Confirm and Sign/i });
    expect(confirmButton).toHaveAttribute('type', 'button');
  });
});
