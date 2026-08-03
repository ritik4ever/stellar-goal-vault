import { describe, expect, it } from 'vitest';
import { formatAmount } from './formatCurrency';

describe('formatAmount', () => {
  describe('zero', () => {
    it('returns "0" for exact zero', () => {
      expect(formatAmount(0)).toBe('0');
    });

    it('returns "0 USDC" with asset code', () => {
      expect(formatAmount(0, 'USDC')).toBe('0 USDC');
    });
  });

  describe('very small amounts (< 0.01)', () => {
    it('formats 0.0000001 with up to 7 decimal places', () => {
      const result = formatAmount(0.0000001);
      expect(result).toBe('0.0000001');
    });

    it('formats 0.001 with up to 7 decimal places', () => {
      const result = formatAmount(0.001);
      expect(result).toBe('0.001');
    });
  });

  describe('medium amounts (0.01 ≤ amount < 1,000)', () => {
    it('formats 0.01 with 2 decimal places', () => {
      const result = formatAmount(0.01);
      // Should have exactly 2 decimal digits
      expect(result).toMatch(/\d+\.\d{2}$/);
      expect(result).toContain('0.01');
    });

    it('formats 999.99 with locale formatting and 2 decimal places', () => {
      const result = formatAmount(999.99);
      expect(result).toMatch(/\d{1,3}(,\d{3})*\.\d{2}$/);
      expect(result).toContain('999.99');
    });

    it('formats 1234.56 with compact notation', () => {
      // 1234.56 ≥ 1000, so it uses compact notation
      const result = formatAmount(1234.56);
      expect(result).toMatch(/1\.2K/);
    });

    it('appends asset code', () => {
      const result = formatAmount(500, 'USDC');
      expect(result).toBe('500.00 USDC');
    });
  });

  describe('thousands (1,000 ≤ amount < 1,000,000)', () => {
    it('formats 1000 with compact notation as 1.0K', () => {
      const result = formatAmount(1000);
      expect(result).toMatch(/1\.0K/);
    });

    it('formats 1500 with compact notation as 1.5K', () => {
      const result = formatAmount(1500);
      expect(result).toMatch(/1\.5K/);
    });

    it('formats 999000 with compact notation as 999.0K', () => {
      const result = formatAmount(999000);
      expect(result).toMatch(/999\.0K/);
    });

    it('appends asset code to compact notation', () => {
      const result = formatAmount(5000, 'USDC');
      expect(result).toBe('5.0K USDC');
    });
  });

  describe('millions (amount ≥ 1,000,000)', () => {
    it('formats 1000000 with compact notation as 1.0M', () => {
      const result = formatAmount(1000000);
      expect(result).toMatch(/1\.0M/);
    });

    it('formats 2500000 with compact notation as 2.5M', () => {
      const result = formatAmount(2500000);
      expect(result).toMatch(/2\.5M/);
    });

    it('formats 1000000 with asset code', () => {
      const result = formatAmount(1000000, 'USDC');
      expect(result).toMatch(/1\.0M USDC/);
    });
  });

  describe('edge cases', () => {
    it('handles negative amounts', () => {
      const result = formatAmount(-500, 'XLM');
      expect(result).toBe('-500.00 XLM');
    });

    it('handles negative small amounts', () => {
      const result = formatAmount(-0.005);
      expect(result).toMatch(/^-0\.005/);
    });

    it('handles exactly 0.01 boundary', () => {
      const result = formatAmount(0.01);
      expect(result).toContain('0.01');
      // Should NOT use compact notation
      expect(result).not.toMatch(/K|M/);
    });
  });
});
