import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SearchInput } from './SearchInput';
import { runAxeAudit, THEMES, type ThemeMode } from '../test/a11yTestUtils';

describe.each(THEMES)('SearchInput Accessibility (%s theme)', (theme: ThemeMode) => {
  it('has no accessibility violations when empty', async () => {
    const { container } = render(<SearchInput value="" onChange={() => {}} />);

    const results = await runAxeAudit(container, theme);
    expect(results).toHaveNoViolations();
  });

  it('has no accessibility violations with a value and clear button', async () => {
    const user = userEvent.setup();
    const { container } = render(<SearchInput value="rocket" onChange={() => {}} />);

    await user.tab();

    const results = await runAxeAudit(container, theme);
    expect(results).toHaveNoViolations();
  });
});
