import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Focused regression coverage for backend unit-suite coverage reporting (#977).
 *
 * Ensures CI continues to publish coverage output and that the repository's
 * configured line-coverage threshold (80%) is not silently weakened.
 */
describe('backend coverage reporting', () => {
  const backendRoot = path.resolve(__dirname, '..');

  it('configures visible coverage reporters and preserves the 80% line threshold', () => {
    const source = fs.readFileSync(path.join(backendRoot, 'vitest.config.ts'), 'utf8');

    expect(source).toMatch(/provider:\s*['"]v8['"]/);
    expect(source).toMatch(/['"]text['"]/);
    expect(source).toMatch(/['"]text-summary['"]/);
    expect(source).toMatch(/['"]lcov['"]/);
    expect(source).toMatch(/['"]html['"]/);
    expect(source).toMatch(/lines:\s*80/);
  });

  it('exposes npm run test:coverage for the backend unit suite', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(backendRoot, 'package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> };

    expect(pkg.scripts?.['test:coverage']).toMatch(/vitest\s+run\s+--coverage/);
  });
});
