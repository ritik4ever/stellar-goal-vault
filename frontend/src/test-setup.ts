import '@testing-library/jest-dom';
import { expect } from 'vitest';

const optionalAxeMatchersModule = "vitest-axe/matchers";

void import(/* @vite-ignore */ optionalAxeMatchersModule)
  .then((module) => {
    expect.extend(module);
  })
  .catch(() => {
    // Accessibility helpers are optional in this workspace.
  });
