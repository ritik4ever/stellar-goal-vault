import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Toast } from '../hooks/useToast';
import { ToastContainer } from './ToastContainer';
import { runAxeAudit, THEMES, type ThemeMode } from '../test/a11yTestUtils';

const sampleToasts: Toast[] = [
  { id: '1', message: 'Campaign created successfully!', variant: 'success' },
  {
    id: '2',
    message: 'Failed to submit pledge. Please try again.',
    variant: 'error',
    link: { href: 'https://stellar.org', label: 'Learn more' },
  },
  { id: '3', message: 'Transaction is being processed on-chain.', variant: 'info' },
  { id: '4', message: 'Campaign deadline is approaching.', variant: 'warning' },
];

describe.each(THEMES)('ToastContainer Accessibility (%s theme)', (theme: ThemeMode) => {
  it('has no accessibility violations for all toast variants', async () => {
    const { container } = render(
      <ToastContainer toasts={sampleToasts} onDismiss={() => {}} />,
    );

    const results = await runAxeAudit(container, theme);
    expect(results).toHaveNoViolations();
  });
});
