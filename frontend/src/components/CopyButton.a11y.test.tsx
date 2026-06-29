import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import CopyButton from './CopyButton';
import { runAxeAudit, THEMES, type ThemeMode } from '../test/a11yTestUtils';

describe.each(THEMES)('CopyButton Accessibility (%s theme)', (theme: ThemeMode) => {
  it('has no accessibility violations', async () => {
    const { container } = render(
      <CopyButton value="GABCD1234567890123456789012345678901234567890" ariaLabel="Copy address" />,
    );

    const results = await runAxeAudit(container, theme);
    expect(results).toHaveNoViolations();
  });
});
