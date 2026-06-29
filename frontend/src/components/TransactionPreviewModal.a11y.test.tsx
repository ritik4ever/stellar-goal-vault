import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TransactionPreviewModal } from './TransactionPreviewModal';
import { runAxeAudit, THEMES, type ThemeMode } from '../test/a11yTestUtils';

const preview = {
  operation: 'Pledge',
  amount: 25,
  assetCode: 'USDC',
  contract: 'CABCDEF1234567890',
  xdr: 'AAAAAgAAAABsamplexdrpayload',
  estimatedFee: {
    stroops: 100,
    xlm: '0.00001',
  },
};

describe.each(THEMES)('TransactionPreviewModal Accessibility (%s theme)', (theme: ThemeMode) => {
  it('has no accessibility violations', async () => {
    const { container } = render(
      <TransactionPreviewModal preview={preview} onConfirm={() => {}} onCancel={() => {}} />,
    );

    const results = await runAxeAudit(container, theme);
    expect(results).toHaveNoViolations();
  });
});
