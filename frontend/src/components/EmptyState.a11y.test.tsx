import { render } from '@testing-library/react';
import { Inbox } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { EmptyState } from './EmptyState';
import { runAxeAudit, THEMES, type ThemeMode } from '../test/a11yTestUtils';

describe.each(THEMES)('EmptyState Accessibility (%s theme)', (theme: ThemeMode) => {
  it('has no accessibility violations in card variant', async () => {
    const { container } = render(
      <EmptyState
        variant="card"
        icon={Inbox}
        title="No campaigns yet"
        message="Create the first vault to make this board active."
      />,
    );

    const results = await runAxeAudit(container, theme);
    expect(results).toHaveNoViolations();
  });

  it('has no accessibility violations in inline variant', async () => {
    const { container } = render(
      <EmptyState variant="inline" title="No results" message="Try adjusting your filters." />,
    );

    const results = await runAxeAudit(container, theme);
    expect(results).toHaveNoViolations();
  });
});
