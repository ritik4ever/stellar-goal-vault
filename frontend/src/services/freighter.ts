import {
  getNetworkDetails,
  isConnected,
  requestAccess,
  signTransaction,
} from '@stellar/freighter-api';
import {
  Address,
  BASE_FEE,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  rpc,
} from '@stellar/stellar-sdk';
import { AppConfig, PledgeTransactionResult, WalletConnection } from '../types/campaign';
import {
  SIGNING_ERROR_MESSAGES,
  SigningErrorClass,
  classifyCause,
  createSigningError,
  describeErrorForLog,
} from '../lib/signingErrors';

type AppErrorLike = Error & { code?: string };

const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';
const MAINNET_PASSPHRASE = 'Public Global Stellar Network ; September 2015';

/** Error with an authored (safe) message; the signing error class comes from the code. */
function buildError(code: string, message: string): AppErrorLike {
  return createSigningError(code, { message });
}

/**
 * Error for a failure whose raw cause comes from the wallet, SDK, or RPC. The
 * raw text is never used as the message; it is kept only as a redacted detail.
 */
function buildCausedError(
  code: string,
  cause: unknown,
  fallbackClass: SigningErrorClass,
  message?: string,
): AppErrorLike {
  return createSigningError(code, {
    signingErrorClass: classifyCause(cause, fallbackClass),
    cause,
    message,
  });
}

/**
 * Builds a transaction operation. Address/contract/amount coercion can throw
 * SDK errors that embed the offending value, so the raw text is replaced with
 * the authored MALFORMED_TRANSACTION message and kept only as a redacted detail.
 */
function buildContractOperation<T>(build: () => T): T {
  try {
    return build();
  } catch (error) {
    throw buildCausedError('INVALID_TRANSACTION_PARAMS', error, 'MALFORMED_TRANSACTION');
  }
}

/**
 * Parses the XDR envelope a wallet returned. A wallet (or an injected/mocked
 * provider) can hand back an unreadable envelope; the SDK's parse error embeds
 * the XDR, so it must never reach the user verbatim.
 */
function decodeSignedTransaction(
  signedXdr: string,
  networkPassphrase: string,
): ReturnType<typeof TransactionBuilder.fromXDR> {
  try {
    return TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
  } catch (error) {
    throw buildCausedError(
      'INVALID_SIGNED_XDR',
      error,
      'MALFORMED_TRANSACTION',
      'Your wallet returned a signature this app could not read. Reconnect the wallet, then try again.',
    );
  }
}

// Exported for testing purposes - internal reference that can be mocked
let getRpcServerImpl: (rpcUrl: string) => rpc.Server = (rpcUrl: string) =>
  new rpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith('http://') });

export function getRpcServer(rpcUrl: string): rpc.Server {
  return getRpcServerImpl(rpcUrl);
}

export function __setGetRpcServerImpl(impl: (rpcUrl: string) => rpc.Server): void {
  getRpcServerImpl = impl;
}

function networkLabel(passphrase: string | undefined): string {
  if (!passphrase) {
    return 'unknown network';
  }
  if (passphrase === TESTNET_PASSPHRASE) {
    return 'Stellar Testnet';
  }
  if (passphrase === MAINNET_PASSPHRASE) {
    return 'Stellar Mainnet';
  }
  return 'the configured network';
}

/**
 * Verifies that the connected Freighter wallet is on the expected network.
 * Throws a FREIGHTER_NETWORK_MISMATCH error if the networks don't match.
 */
export async function verifyFreighterNetwork(expectedNetworkPassphrase: string): Promise<void> {
  try {
    const details = await getNetworkDetails();
    const currentPassphrase = details.networkPassphrase;
    if (currentPassphrase !== expectedNetworkPassphrase) {
      throw buildError(
        'FREIGHTER_NETWORK_MISMATCH',
        `Freighter is connected to ${networkLabel(currentPassphrase)}, but this app expects ${networkLabel(expectedNetworkPassphrase)}. ` +
          `Please switch your wallet to ${networkLabel(expectedNetworkPassphrase)} and try again.`,
      );
    }
  } catch (error) {
    if (error instanceof Error && (error as AppErrorLike).code === 'FREIGHTER_NETWORK_MISMATCH') {
      throw error;
    }
    // If we can't get network details, we'll let the transaction simulation catch the mismatch
    // eslint-disable-next-line no-console -- the wallet layer has no logger dependency
    console.warn('Could not verify Freighter network:', describeErrorForLog(error));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

const STROOPS_PER_XLM = 10_000_000;

export interface EstimatedFee {
  stroops: number;
  xlm: string;
}

function formatStroopsAsXlm(stroops: number): string {
  return (stroops / STROOPS_PER_XLM).toFixed(7).replace(/\.?0+$/, '');
}

/**
 * Derives the estimated network fee from a transaction that has already been
 * prepared from a Soroban simulation. The prepared transaction's fee covers the
 * inclusion fee plus the simulated resource fee, i.e. what the wallet will be
 * asked to pay. Returns null when the fee cannot be parsed so the UI can fall
 * back to a "Calculating..." state instead of showing a misleading value.
 */
function estimateFeeFromTransaction(transaction: { fee: string }): EstimatedFee | null {
  try {
    const feeStroops = Number(transaction.fee);
    if (!Number.isFinite(feeStroops) || feeStroops < 0) {
      return null;
    }
    return { stroops: feeStroops, xlm: formatStroopsAsXlm(feeStroops) };
  } catch {
    return null;
  }
}

export function amountToContractUnits(amount: number, decimals: number): bigint {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw buildError('INVALID_AMOUNT', 'Pledge amount must be greater than zero.');
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 12) {
    throw buildError('INVALID_DECIMALS', 'Invalid contract amount decimals configuration.');
  }

  const factor = 10 ** decimals;
  const scaled = amount * factor;
  const rounded = Math.round(scaled);
  if (Math.abs(scaled - rounded) > 1e-8) {
    throw buildError(
      'INVALID_AMOUNT_PRECISION',
      `Amount must use no more than ${decimals} decimal place${decimals === 1 ? '' : 's'}.`,
    );
  }

  return BigInt(rounded);
}

export async function connectFreighterWallet(
  expectedNetworkPassphrase: string,
): Promise<WalletConnection> {
  let connected: boolean;
  try {
    connected = await isConnected();
  } catch (error) {
    // A throwing existence probe means the extension is unavailable, not that
    // the user rejected anything, so classify it as WALLET_UNAVAILABLE.
    throw buildCausedError('FREIGHTER_UNAVAILABLE', error, 'WALLET_UNAVAILABLE');
  }
  if (!connected) {
    throw buildError(
      'FREIGHTER_UNAVAILABLE',
      'Freighter was not detected. Install or unlock the extension and try again.',
    );
  }

  let publicKey: string;
  try {
    publicKey = await requestAccess();
  } catch (error) {
    throw buildCausedError('FREIGHTER_ACCESS_DENIED', error, 'USER_REJECTED');
  }

  let details:
    | {
        networkPassphrase: string;
        sorobanRpcUrl?: string;
      }
    | undefined;

  try {
    const networkDetails = await getNetworkDetails();
    details = {
      networkPassphrase: networkDetails.networkPassphrase,
      sorobanRpcUrl: networkDetails.sorobanRpcUrl,
    };
  } catch {
    details = undefined;
  }

  if (details?.networkPassphrase && details.networkPassphrase !== expectedNetworkPassphrase) {
    throw buildError(
      'FREIGHTER_NETWORK_MISMATCH',
      `Freighter is connected to ${networkLabel(details.networkPassphrase)}, but this app expects ${networkLabel(expectedNetworkPassphrase)}.`,
    );
  }

  return {
    publicKey,
    networkPassphrase: details?.networkPassphrase,
    sorobanRpcUrl: details?.sorobanRpcUrl,
  };
}

async function waitForTransaction(
  server: rpc.Server,
  transactionHash: string,
): Promise<PledgeTransactionResult> {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    let result: Awaited<ReturnType<rpc.Server['getTransaction']>>;
    try {
      result = await server.getTransaction(transactionHash);
    } catch (error) {
      // Polling failures are transport problems, never signing failures.
      throw buildCausedError('TRANSACTION_STATUS_UNAVAILABLE', error, 'RPC_FAILURE');
    }
    if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      return {
        transactionHash,
        confirmedAt: result.createdAt,
      };
    }
    if (result.status === rpc.Api.GetTransactionStatus.FAILED) {
      throw buildError(
        'TRANSACTION_FAILED',
        `The network rejected transaction ${transactionHash}. ${SIGNING_ERROR_MESSAGES.CONTRACT_REJECTED}`,
      );
    }
    await sleep(1200);
  }

  throw buildError(
    'TRANSACTION_TIMEOUT',
    `Transaction ${transactionHash} was submitted but did not confirm before the UI timeout. Check it on Stellar Expert before retrying.`,
  );
}

export async function submitFreighterClaim(params: {
  campaignId: string;
  creator: string;
  config: AppConfig;
  onPreview?: (preview: {
    operation: string;
    amount?: number;
    assetCode?: string;
    contract: string;
    xdr: string;
    estimatedFee?: EstimatedFee;
  }) => Promise<boolean>;
}): Promise<PledgeTransactionResult> {
  const { campaignId, creator, config } = params;

  if (!config.contractId || !config.sorobanRpcUrl) {
    throw buildError(
      'CONFIG_MISSING',
      'Wallet signing is not configured yet. Set CONTRACT_ID and SOROBAN_RPC_URL on the backend.',
    );
  }

  // Verify wallet network matches expected network before proceeding
  await verifyFreighterNetwork(config.networkPassphrase);

  const server = getRpcServer(config.sorobanRpcUrl);
  const sourceAccount = await server.getAccount(creator).catch((error) => {
    throw buildCausedError('SOURCE_ACCOUNT_LOAD_FAILED', error, 'RPC_FAILURE');
  });

  const operation = buildContractOperation(() =>
    new Contract(config.contractId).call(
      'claim',
      nativeToScVal(BigInt(campaignId), { type: 'u64' }),
      Address.fromString(creator).toScVal(),
    ),
  );

  const transaction = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(operation)
    .setTimeout(60)
    .build();

  const simulation = await server.simulateTransaction(transaction).catch((error) => {
    throw createSigningError('SIMULATION_FAILED', {
      signingErrorClass: 'RPC_FAILURE',
      cause: error,
    });
  });

  if ('error' in simulation) {
    throw buildCausedError('SIMULATION_FAILED', simulation.error, 'MALFORMED_TRANSACTION');
  }

  if ('restorePreamble' in simulation) {
    throw buildError(
      'STATE_RESTORE_REQUIRED',
      'The contract state is archived and must be restored before claiming.',
    );
  }

  let preparedTransaction;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- simulateTransaction returns a union the SDK does not narrow here
    preparedTransaction = rpc.assembleTransaction(transaction, simulation as any).build();
  } catch (error) {
    throw buildCausedError('SIMULATION_PREPARE_FAILED', error, 'MALFORMED_TRANSACTION');
  }

  if (params.onPreview) {
    const isApproved = await params.onPreview({
      operation: 'claim',
      contract: config.contractId,
      xdr: preparedTransaction.toXDR(),
      estimatedFee: estimateFeeFromTransaction(preparedTransaction) ?? undefined,
    });
    if (!isApproved) {
      throw buildError('USER_CANCELLED', 'User cancelled the transaction from the preview panel.');
    }
  }

  let signedXdr: string;
  try {
    signedXdr = await signTransaction(preparedTransaction.toXDR(), {
      accountToSign: creator,
      networkPassphrase: config.networkPassphrase,
    });
  } catch (error) {
    throw buildCausedError('SIGNING_FAILED', error, 'UNKNOWN');
  }

  if (!signedXdr) {
    throw buildError('SIGNING_FAILED', 'Freighter did not return a signed transaction.');
  }

  const signedTransaction = decodeSignedTransaction(signedXdr, config.networkPassphrase);
  const sendResult = await server.sendTransaction(signedTransaction).catch((error) => {
    throw createSigningError('SUBMISSION_FAILED', {
      signingErrorClass: 'RPC_FAILURE',
      cause: error,
    });
  });

  if (sendResult.status === 'ERROR') {
    throw buildError(
      'CONTRACT_CALL_FAILED',
      `Soroban RPC rejected the claim transaction ${sendResult.hash}. ${SIGNING_ERROR_MESSAGES.CONTRACT_REJECTED}`,
    );
  }

  if (sendResult.status === 'TRY_AGAIN_LATER') {
    throw buildError(
      'SUBMISSION_RETRY',
      'Soroban RPC asked the client to retry claim submission later.',
    );
  }

  if (!sendResult.hash) {
    throw buildError(
      'SUBMISSION_FAILED',
      'Soroban RPC accepted the claim but did not return a transaction hash.',
    );
  }

  return waitForTransaction(server, sendResult.hash);
}

export async function submitFreighterPledge(params: {
  campaignId: string;
  contributor: string;
  amount: number;
  assetCode: string;
  config: AppConfig;
  onPreview?: (preview: {
    operation: string;
    amount?: number;
    assetCode?: string;
    contract: string;
    xdr: string;
    estimatedFee?: EstimatedFee;
  }) => Promise<boolean>;
}): Promise<PledgeTransactionResult> {
  const { campaignId, contributor, amount, config, assetCode } = params;

  if (!config.contractId || !config.sorobanRpcUrl) {
    throw buildError(
      'CONFIG_MISSING',
      'Wallet signing is not configured yet. Set CONTRACT_ID and SOROBAN_RPC_URL on the backend.',
    );
  }

  // Verify wallet network matches expected network before proceeding
  await verifyFreighterNetwork(config.networkPassphrase);

  const server = getRpcServer(config.sorobanRpcUrl);
  const amountUnits = amountToContractUnits(amount, config.contractAmountDecimals);
  const tokenAddress = config.assetAddresses[assetCode.toUpperCase()];

  if (!tokenAddress) {
    throw buildError(
      'ASSET_NOT_CONFIGURED',
      `Soroban contract address for ${assetCode} is not configured.`,
    );
  }

  const sourceAccount = await server.getAccount(contributor).catch((error) => {
    throw buildCausedError('SOURCE_ACCOUNT_LOAD_FAILED', error, 'RPC_FAILURE');
  });

  const operation = buildContractOperation(() =>
    new Contract(config.contractId).call(
      'contribute',
      nativeToScVal(BigInt(campaignId), { type: 'u64' }),
      Address.fromString(contributor).toScVal(),
      Address.fromString(tokenAddress).toScVal(),
      nativeToScVal(amountUnits, { type: 'i128' }),
    ),
  );

  const transaction = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(operation)
    .setTimeout(60)
    .build();

  const simulation = await server.simulateTransaction(transaction).catch((error) => {
    throw createSigningError('SIMULATION_FAILED', {
      signingErrorClass: 'RPC_FAILURE',
      cause: error,
    });
  });

  if ('error' in simulation) {
    throw buildCausedError('SIMULATION_FAILED', simulation.error, 'MALFORMED_TRANSACTION');
  }

  if ('restorePreamble' in simulation) {
    throw buildError(
      'STATE_RESTORE_REQUIRED',
      'The contract state is archived and must be restored before pledging.',
    );
  }

  let preparedTransaction;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- simulateTransaction returns a union the SDK does not narrow here
    preparedTransaction = rpc.assembleTransaction(transaction, simulation as any).build();
  } catch (error) {
    throw buildCausedError('SIMULATION_PREPARE_FAILED', error, 'MALFORMED_TRANSACTION');
  }

  if (params.onPreview) {
    const isApproved = await params.onPreview({
      operation: 'contribute',
      amount: params.amount,
      assetCode: params.assetCode,
      contract: config.contractId,
      xdr: preparedTransaction.toXDR(),
      estimatedFee: estimateFeeFromTransaction(preparedTransaction) ?? undefined,
    });
    if (!isApproved) {
      throw buildError('USER_CANCELLED', 'User cancelled the transaction from the preview panel.');
    }
  }

  let signedXdr: string;
  try {
    signedXdr = await signTransaction(preparedTransaction.toXDR(), {
      accountToSign: contributor,
      networkPassphrase: config.networkPassphrase,
    });
  } catch (error) {
    throw buildCausedError('SIGNING_FAILED', error, 'UNKNOWN');
  }

  if (!signedXdr) {
    throw buildError('SIGNING_FAILED', 'Freighter did not return a signed transaction.');
  }

  const signedTransaction = decodeSignedTransaction(signedXdr, config.networkPassphrase);
  const sendResult = await server.sendTransaction(signedTransaction).catch((error) => {
    throw createSigningError('SUBMISSION_FAILED', {
      signingErrorClass: 'RPC_FAILURE',
      cause: error,
    });
  });

  if (sendResult.status === 'ERROR') {
    throw createSigningError('SUBMISSION_FAILED', {
      signingErrorClass: 'CONTRACT_REJECTED',
      message: `Soroban RPC rejected the transaction ${sendResult.hash}. ${SIGNING_ERROR_MESSAGES.CONTRACT_REJECTED}`,
    });
  }

  if (sendResult.status === 'TRY_AGAIN_LATER') {
    throw buildError(
      'SUBMISSION_RETRY',
      'Soroban RPC asked the client to retry transaction submission later.',
    );
  }

  if (!sendResult.hash) {
    throw buildError(
      'SUBMISSION_FAILED',
      'Soroban RPC accepted the transaction but did not return a transaction hash.',
    );
  }

  return waitForTransaction(server, sendResult.hash);
}

export function watchFreighterAccount(onChange: (address: string) => void): () => void {
  let lastAddress = '';
  const id = window.setInterval(async () => {
    try {
      const address = await requestAccess();
      if (address !== lastAddress) {
        lastAddress = address;
        onChange(address);
      }
    } catch {
      // extension unavailable or locked — treat as disconnected
      if (lastAddress !== '') {
        lastAddress = '';
        onChange('');
      }
    }
  }, 2000);
  return () => window.clearInterval(id);
}
