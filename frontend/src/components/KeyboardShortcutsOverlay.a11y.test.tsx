import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { KeyboardShortcutsOverlay } from './KeyboardShortcutsOverlay';
import { runAxeAudit, THEMES, type ThemeMode } from '../test/a11yTestUtils';

describe.each(THEMES)('KeyboardShortcutsOverlay Accessibility (%s theme)', (theme: ThemeMode) => {
  it('has no accessibility violations when open', async () => {
    const { container } = render(
      <KeyboardShortcutsOverlay isOpen onClose={() => {}} />,
    );

    const results = await runAxeAudit(container, theme);
    expect(results).toHaveNoViolations();
  });
});
