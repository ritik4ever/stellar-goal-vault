import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TransactionPreviewModal } from './TransactionPreviewModal';

const basePreview = {
  operation: 'Pledge',
  amount: 100,
  contract: 'CTEST123',
  xdr: 'AAAA'
};

describe('TransactionPreviewModal fee display', () => {
  it('shows estimated fee when provided', () => {
    render(
      <TransactionPreviewModal
        preview={{ ...basePreview, estimatedFee: { stroops: 100, xlm: '0.00001' } }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByText(/0.00001 XLM \(100 stroops\)/)).toBeInTheDocument();
  });

  it('shows calculating when fee is not provided', () => {
    render(
      <TransactionPreviewModal
        preview={basePreview}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByText('Calculating...')).toBeInTheDocument();
  });

  it('shows correct fee format', () => {
    render(
      <TransactionPreviewModal
        preview={{ ...basePreview, estimatedFee: { stroops: 200, xlm: '0.00002' } }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByText(/Estimated network fee/)).toBeInTheDocument();
  });
});
