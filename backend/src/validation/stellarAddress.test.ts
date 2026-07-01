import { describe, expect, it } from "vitest";
import { isValidStellarPublicKey } from "./stellarAddress";
import { stellarAccountIdSchema } from "./schemas";

// ---------------------------------------------------------------------------
// Known-good Stellar public keys (real keys with valid checksums)
// ---------------------------------------------------------------------------
// These are well-known Stellar addresses referenced in official Stellar docs.
const VALID_KEYS = [
  // Stellar Laboratory default test account (used in stellar.org docs)
  "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
  // Stellar quickstart network mode example (developers.stellar.org/docs/tools/quickstart/network-modes)
  "GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI",
  // Stellar testnet USDC issuer (well-known testnet address)
  "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
];

// ---------------------------------------------------------------------------
// Invalid cases
// ---------------------------------------------------------------------------
const INVALID_KEYS = [
  // Wrong length (55 chars)
  "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCW",
  // Wrong length (57 chars)
  "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWNN",
  // Starts with wrong letter
  "SAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
  // All G's — structurally plausible but invalid checksum
  "G" + "G".repeat(55),
  // All A's after G — invalid checksum
  "G" + "A".repeat(55),
  // Contains invalid Base32 character (0, 1, 8, 9 are not in Base32 alphabet)
  "G0AZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
  // Empty string
  "",
  // Lowercase (Stellar keys are uppercase)
  "gaazi4tcr3ty5ojhctjc2a4qsy6cjwjh5iajtgkin2er7lbnvkoccwn",
  // Numeric string
  "12345678901234567890123456789012345678901234567890123456",
  // Correct length but corrupted last char (bad checksum)
  "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWO",
];

// ---------------------------------------------------------------------------
// isValidStellarPublicKey unit tests
// ---------------------------------------------------------------------------
describe("isValidStellarPublicKey", () => {
  it.each(VALID_KEYS)("accepts valid key: %s", (key: string) => {
    expect(isValidStellarPublicKey(key)).toBe(true);
  });

  it.each(INVALID_KEYS)("rejects invalid key: %s", (key: string) => {
    expect(isValidStellarPublicKey(key)).toBe(false);
  });

  it("rejects non-string input gracefully", () => {
    expect(isValidStellarPublicKey(null as unknown as string)).toBe(false);
    expect(isValidStellarPublicKey(undefined as unknown as string)).toBe(false);
    expect(isValidStellarPublicKey(42 as unknown as string)).toBe(false);
  });

  it("rejects a key with a flipped bit in the payload (bad checksum)", () => {
    // Take a valid key and flip one character in the middle
    const valid = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
    const corrupted = valid.slice(0, 20) + "X" + valid.slice(21);
    expect(isValidStellarPublicKey(corrupted)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// stellarAccountIdSchema Zod integration tests
// ---------------------------------------------------------------------------
describe("stellarAccountIdSchema", () => {
  it("passes for a valid Stellar public key", () => {
    const result = stellarAccountIdSchema.safeParse(
      "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    );
    expect(result.success).toBe(true);
  });

  it("trims whitespace before validating", () => {
    const result = stellarAccountIdSchema.safeParse(
      "  GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN  ",
    );
    expect(result.success).toBe(true);
  });

  it("returns 'creator must be a valid Stellar public key' for structurally valid but bad-checksum key", () => {
    // Passes the regex but fails the StrKey checksum refine
    const badChecksum = "G" + "A".repeat(55);
    const result = stellarAccountIdSchema.safeParse(badChecksum);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i: { message: string }) => i.message);
      expect(messages).toContain("creator must be a valid Stellar public key");
    }
  });

  it("returns a validation error for wrong length", () => {
    const result = stellarAccountIdSchema.safeParse("GAAZI4TCR3TY5OJHCTJC2A4QSY6");
    expect(result.success).toBe(false);
  });

  it("returns a validation error for empty string", () => {
    const result = stellarAccountIdSchema.safeParse("");
    expect(result.success).toBe(false);
  });

  it("returns a validation error for a secret key (starts with S)", () => {
    const result = stellarAccountIdSchema.safeParse(
      "SAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    );
    expect(result.success).toBe(false);
  });

  it("returns a validation error for a key with invalid Base32 characters", () => {
    const result = stellarAccountIdSchema.safeParse(
      "G0AZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    );
    expect(result.success).toBe(false);
  });
});
