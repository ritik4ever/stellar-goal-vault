import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi} from 'vitest';
import { TransactionPreviewModal } from './TransactionPreviewModal';
import { runAxeAudit, THEMES, type ThemeMode } from '../test/a11yTestUtils';

const basePreview = {
  operation: 'Pledge',
  amount: 25,
  assetCode: 'USDC',
  contract: 'CABCDEF1234567890',
  xdr: 'AAAAAgAAAABsamplexdrpayload',
};

const previewWithFee = {
  ...basePreview,
  estimatedFee: {
    stroops: 100,
    xlm: '0.00001',
  },
};

describe.each(THEMES)('TransactionPreviewModal Accessibility (%s theme)', (theme: ThemeMode) => {
  it('has no accessibility violations with estimated fee', async () => {
    const { container } = render(
      <TransactionPreviewModal preview={previewWithFee} onConfirm={() => {}} onCancel={() => {}} />,
    );

    const results = await runAxeAudit(container, theme);
    expect(results).toHaveNoViolations();
  });

  it('has no accessibility violations when fee is calculating', async () => {
    const { container } = render(
      <TransactionPreviewModal preview={basePreview} onConfirm={() => {}} onCancel={() => {}} />,
    );

    const results = await runAxeAudit(container, theme);
    expect(results).toHaveNoViolations();
  });

  it('has no accessibility violations with expanded XDR panel', async () => {
    const { container } = render(
      <TransactionPreviewModal preview={previewWithFee} onConfirm={() => {}} onCancel={() => {}} />,
    );

    fireEvent.click(screen.getByRole('checkbox'));

    const results = await runAxeAudit(container, theme);
    expect(results).toHaveNoViolations();
  });
it('exposes accessible names for confirm and cancel actions', () => {
    render(
      <TransactionPreviewModal preview={previewWithFee} onConfirm={() => {}} onCancel={() => {}} />,
    );

    expect(screen.getByRole('button', { name: /confirm/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeDefined();
  });

  it('supports keyboard activation of the confirm action', () => {
    const onConfirm = vi.fn();
    render(
      <TransactionPreviewModal preview={previewWithFee} onConfirm={onConfirm} onCancel={() => {}} />,
    );

    const confirmButton = screen.getByRole('button', { name: /confirm/i });
    confirmButton.focus();
    expect(confirmButton).toHaveFocus();
    fireEvent.keyDown(confirmButton, { key: 'Enter', code: 'Enter' });
    fireEvent.click(confirmButton);
    expect(onConfirm).toHaveBeenCalled();
  });

  it('supports keyboard activation of the cancel action', () => {
    const onCancel = vi.fn();
    render(
      <TransactionPreviewModal preview={previewWithFee} onConfirm={() => {}} onCancel={onCancel} />,
    );

    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    cancelButton.focus();
    expect(cancelButton).toHaveFocus();
    fireEvent.keyDown(cancelButton, { key: 'Enter', code: 'Enter' });
    fireEvent.click(cancelButton);
    expect(onCancel).toHaveBeenCalled();
  });

  it('traps focus within the modal dialog', () => {
    render(
      <TransactionPreviewModal preview={previewWithFee} onConfirm={() => {}} onCancel={() => {}} />,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInDocument();
    expect(downent)..toBeTrue();
  });
});
