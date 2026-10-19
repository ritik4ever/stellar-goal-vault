/**
 * Classification and sanitisation of wallet signing / submission failures.
 *
 * Raw wallet, SDK, and RPC errors can carry signed XDR, secret seeds, or
 * internal details. Nothing raw is shown to users: every failure is mapped to
 * one of a fixed set of classes, each with an authored, actionable message.
 * The raw text is kept only as a redacted, truncated `detail` for diagnostics.
 */

export type SigningErrorClass =
  | 'USER_REJECTED'
  | 'WALLET_UNAVAILABLE'
  | 'MALFORMED_TRANSACTION'
  | 'RPC_FAILURE'
  | 'CONTRACT_REJECTED'
  | 'UNKNOWN';

export const SIGNING_ERROR_MESSAGES: Record<SigningErrorClass, string> = {
  USER_REJECTED: 'You cancelled the signature in your wallet. Click the button again to retry.',
  WALLET_UNAVAILABLE: 'Wallet not detected or locked. Install or unlock Freighter, then reconnect.',
  MALFORMED_TRANSACTION:
    'The transaction could not be built from these details. Check the amount and campaign, then try again.',
  RPC_FAILURE: 'Could not reach the Stellar network. Check your connection and retry in a moment.',
  CONTRACT_REJECTED:
    'The contract rejected this transaction. Check the campaign status and your balance before retrying.',
  UNKNOWN: 'The transaction could not be completed. Refresh the page and try again.',
};

/** Error codes raised by this app's wallet services, grouped by class. */
const CODE_CLASSES: Record<string, SigningErrorClass> = {
  USER_CANCELLED: 'USER_REJECTED',
  FREIGHTER_ACCESS_DENIED: 'USER_REJECTED',
  FREIGHTER_UNAVAILABLE: 'WALLET_UNAVAILABLE',
  FREIGHTER_NETWORK_MISMATCH: 'WALLET_UNAVAILABLE',
  INVALID_AMOUNT: 'MALFORMED_TRANSACTION',
  INVALID_AMOUNT_PRECISION: 'MALFORMED_TRANSACTION',
  INVALID_DECIMALS: 'MALFORMED_TRANSACTION',
  ASSET_NOT_CONFIGURED: 'MALFORMED_TRANSACTION',
  CONFIG_MISSING: 'MALFORMED_TRANSACTION',
  SIMULATION_FAILED: 'MALFORMED_TRANSACTION',
  SIMULATION_PREPARE_FAILED: 'MALFORMED_TRANSACTION',
  SOURCE_ACCOUNT_LOAD_FAILED: 'RPC_FAILURE',
  SUBMISSION_FAILED: 'RPC_FAILURE',
  SUBMISSION_RETRY: 'RPC_FAILURE',
  TRANSACTION_TIMEOUT: 'RPC_FAILURE',
  TRANSACTION_EXPIRED: 'RPC_FAILURE',
  RPC_UNAVAILABLE: 'RPC_FAILURE',
  STATE_RESTORE_REQUIRED: 'CONTRACT_REJECTED',
  CONTRACT_CALL_FAILED: 'CONTRACT_REJECTED',
  TRANSACTION_FAILED: 'CONTRACT_REJECTED',
  TRANSACTION_REJECTED: 'CONTRACT_REJECTED',
};

/**
 * Ordered text heuristics for raw wallet/SDK/RPC errors without a known code.
 * The first match wins, so the mapping is deterministic.
 */
const TEXT_RULES: Array<[RegExp, SigningErrorClass]> = [
  [
    /user (rejected|declined|denied|cancell?ed)|(rejected|declined|denied|cancell?ed) by (the )?user|request (was )?(rejected|declined|denied)/i,
    'USER_REJECTED',
  ],
  [
    /not (installed|detected|connected|available)|locked|no wallet|extension/i,
    'WALLET_UNAVAILABLE',
  ],
  [
    /xdr|malformed|could not parse|invalid (transaction|envelope|param|argument)/i,
    'MALFORMED_TRANSACTION',
  ],
  [
    /timed? ?out|network ?error|failed to fetch|econn|enotfound|socket|unavailable|\b50[0-4]\b|try_again_later/i,
    'RPC_FAILURE',
  ],
  [/contract|host ?error|tx_?failed|\bop_/i, 'CONTRACT_REJECTED'],
  // Stellar transaction result codes, e.g. txBadSeq, txInsufficientBalance.
  [/\btx[A-Z]\w+/, 'CONTRACT_REJECTED'],
];

const SIGNING_ERROR_CLASSES = new Set(Object.keys(SIGNING_ERROR_MESSAGES));

type ErrorLike = {
  code?: unknown;
  signingErrorClass?: unknown;
  message?: unknown;
  status?: unknown;
  response?: { status?: unknown };
};

function rawText(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const message = (error as ErrorLike).message;
    if (typeof message === 'string') return message;
    try {
      return JSON.stringify(error);
    } catch {
      return '';
    }
  }
  return '';
}

/** Maps any raw wallet/SDK/RPC error to a signing error class. */
export function classifySigningError(error: unknown): SigningErrorClass {
  const err = (error && typeof error === 'object' ? error : {}) as ErrorLike;

  if (
    typeof err.signingErrorClass === 'string' &&
    SIGNING_ERROR_CLASSES.has(err.signingErrorClass)
  ) {
    return err.signingErrorClass as SigningErrorClass;
  }
  if (typeof err.code === 'string' && CODE_CLASSES[err.code]) {
    return CODE_CLASSES[err.code];
  }

  const status = Number(err.status ?? err.response?.status);
  if (Number.isFinite(status) && status >= 500) {
    return 'RPC_FAILURE';
  }

  const text = rawText(error);
  for (const [pattern, signingErrorClass] of TEXT_RULES) {
    if (pattern.test(text)) {
      return signingErrorClass;
    }
  }
  return 'UNKNOWN';
}

// Stellar secret seeds: "S" + 55 base32 characters (StrKey ed25519 secret seed).
const STELLAR_SECRET_SEED_RE = /\bS[A-Z2-7]{55}\b/g;
// Base64 XDR transaction envelopes (signed or unsigned) start with "AAAA".
const XDR_BLOB_RE = /\bAAAA[A-Za-z0-9+/]{76,}={0,2}/g;
const MAX_DETAIL_LENGTH = 300;

/** Removes secret seeds and transaction envelope XDR from free text. */
export function redactSecretMaterial(text: string): string {
  return text
    .replace(STELLAR_SECRET_SEED_RE, '[REDACTED_SECRET]')
    .replace(XDR_BLOB_RE, '[REDACTED_XDR]');
}

/** A redacted, single-line, length-capped description safe for logs. */
export function describeErrorForLog(error: unknown): string {
  const text = redactSecretMaterial(rawText(error)).replace(/\s+/g, ' ').trim();
  return text.length > MAX_DETAIL_LENGTH ? `${text.slice(0, MAX_DETAIL_LENGTH)}…` : text;
}

export type SigningError = Error & {
  code: string;
  signingErrorClass: SigningErrorClass;
  /** Redacted diagnostic text from the underlying error; never shown to users. */
  detail?: string;
};

/**
 * Builds a safe error for a failure. The user-facing message is either the
 * caller's authored message (which must not include raw error text) or the
 * class message. The raw cause survives only as a redacted `detail`.
 */
export function createSigningError(
  code: string,
  options: { signingErrorClass?: SigningErrorClass; message?: string; cause?: unknown } = {},
): SigningError {
  const signingErrorClass =
    options.signingErrorClass ?? CODE_CLASSES[code] ?? classifySigningError(options.cause);
  const error = new Error(
    options.message ?? SIGNING_ERROR_MESSAGES[signingErrorClass],
  ) as SigningError;
  error.code = code;
  error.signingErrorClass = signingErrorClass;
  if (options.cause !== undefined) {
    error.detail = describeErrorForLog(options.cause);
  }
  return error;
}

/** Classifies a raw cause, using `fallback` when nothing more specific matches. */
export function classifyCause(cause: unknown, fallback: SigningErrorClass): SigningErrorClass {
  const signingErrorClass = classifySigningError(cause);
  return signingErrorClass === 'UNKNOWN' ? fallback : signingErrorClass;
}

/** Converts an arbitrary thrown value into a safe SigningError. */
export function toSigningError(error: unknown, fallbackCode = 'SIGNING_FAILED'): SigningError {
  const err = (error && typeof error === 'object' ? error : {}) as ErrorLike;
  if (typeof err.signingErrorClass === 'string' && typeof err.code === 'string') {
    return error as SigningError;
  }
  const signingErrorClass = classifySigningError(error);
  return createSigningError(typeof err.code === 'string' ? err.code : fallbackCode, {
    signingErrorClass,
    cause: error,
  });
}
