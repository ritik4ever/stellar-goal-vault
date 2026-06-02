/**
 * Stellar StrKey Ed25519 public key validation.
 *
 * Replicates the logic of `StrKey.isValidEd25519PublicKey` from @stellar/stellar-sdk
 * without requiring the full SDK as a runtime dependency.
 *
 * A valid Stellar public key (G-address) is a Base32-encoded string where:
 *   - Byte 0:      version byte 0x30 (encodes as leading 'G' in Base32)
 *   - Bytes 1–32:  32-byte Ed25519 public key payload
 *   - Bytes 33–34: CRC-16/XModem checksum of bytes 0–32 (little-endian)
 *
 * Reference: SEP-0023 https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0023.md
 */

// Base32 alphabet used by Stellar (RFC 4648, uppercase, no padding required here)
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * Decodes a Base32 string into a Uint8Array.
 * Returns null if the input contains characters outside the Base32 alphabet.
 */
function base32Decode(input: string): Uint8Array | null {
  // Strip padding
  const s = input.replace(/=+$/, "").toUpperCase();
  const lookup = new Uint8Array(256).fill(255);
  for (let i = 0; i < BASE32_ALPHABET.length; i++) {
    lookup[BASE32_ALPHABET.charCodeAt(i)] = i;
  }

  const outputLength = Math.floor((s.length * 5) / 8);
  const output = new Uint8Array(outputLength);

  let buffer = 0;
  let bitsLeft = 0;
  let outIdx = 0;

  for (let i = 0; i < s.length; i++) {
    const val = lookup[s.charCodeAt(i)];
    if (val === 255) return null; // invalid character
    buffer = (buffer << 5) | val;
    bitsLeft += 5;
    if (bitsLeft >= 8) {
      bitsLeft -= 8;
      output[outIdx++] = (buffer >> bitsLeft) & 0xff;
    }
  }

  return output;
}

/**
 * Computes CRC-16/XModem over the given bytes.
 * Polynomial: 0x1021, initial value: 0x0000, no reflection.
 */
function crc16xmodem(data: Uint8Array): number {
  let crc = 0x0000;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i] << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

/**
 * Returns true if the given string is a valid Stellar Ed25519 public key (G-address).
 *
 * Equivalent to `StrKey.isValidEd25519PublicKey(address)` from @stellar/stellar-sdk.
 */
export function isValidStellarPublicKey(address: string): boolean {
  // Quick structural check: must be exactly 56 chars starting with G
  if (typeof address !== "string" || address.length !== 56 || address[0] !== "G") {
    return false;
  }

  const decoded = base32Decode(address);
  // Decoded length must be 35: 1 version + 32 key + 2 checksum
  if (!decoded || decoded.length !== 35) {
    return false;
  }

  // Version byte for Ed25519 public key is 0x30
  if (decoded[0] !== 0x30) {
    return false;
  }

  // Verify CRC-16/XModem checksum (last 2 bytes, little-endian)
  const payload = decoded.slice(0, 33);
  const expectedCrc = (decoded[34] << 8) | decoded[33]; // little-endian
  const actualCrc = crc16xmodem(payload);

  return actualCrc === expectedCrc;
}
