import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
      <TransactionPreviewModal
        preview={previewWithFee}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
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
      <TransactionPreviewModal
        preview={previewWithFee}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('checkbox'));

    const results = await runAxeAudit(container, theme);
    expect(results).toHaveNoViolations();
  });
});
