import type { AxeMatchers } from 'vitest-axe/matchers';

/**
 * `vitest-axe` registers its `toHaveNoViolations` matcher at runtime through
 * `expect.extend(...)` in `src/test-setup.ts`. The package does not ship the
 * ambient module augmentation itself, so it is declared here to make the
 * matcher visible to the type checker.
 */
declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  interface Assertion<T = any> extends AxeMatchers {}
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  interface AsymmetricMatchersContaining extends AxeMatchers {}
}
