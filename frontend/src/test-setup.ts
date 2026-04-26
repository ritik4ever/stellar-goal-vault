import '@testing-library/jest-dom';
import * as matchers from 'vitest-axe/matchers';
import { expect } from 'vitest';

// Extend Vitest's expect with axe core matchers like toHaveNoViolations
expect.extend(matchers);