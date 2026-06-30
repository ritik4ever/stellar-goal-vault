import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SortDropdown } from './SortDropdown';
import { runAxeAudit, THEMES, type ThemeMode } from '../test/a11yTestUtils';

describe.each(THEMES)('SortDropdown Accessibility (%s theme)', (theme: ThemeMode) => {
  it('has no accessibility violations', async () => {
    const { container } = render(
      <SortDropdown value="createdAt" onChange={() => {}} />,
    );

    const results = await runAxeAudit(container, theme);
    expect(results).toHaveNoViolations();
  });
});
