import { requestAccess, signTransaction } from '@stellar/freighter-api';
import {
  Address,
  BASE_FEE,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  rpc,
} from '@stellar/stellar-sdk';
import { getAppConfig } from './api';
import { SorobanRefundMetadata } from '../types/campaign';
import { GoalVaultContract } from '../generated';
import { verifyFreighterNetwork } from './freighter';
import {
  SigningErrorClass,
  classifyCause,
  createSigningError,
  toSigningError,
} from '../lib/signingErrors';

function causedError(
  code: string,
  cause: unknown,
  fallbackClass: SigningErrorClass,
  message?: string,
) {
  return createSigningError(code, {
    signingErrorClass: classifyCause(cause, fallbackClass),
    cause,
    message,
  });
}

/**
 * Parses an assembled transaction or the XDR a wallet returned. Both throw SDK
 * errors that embed the envelope itself, so the raw text is swapped for the
 * authored MALFORMED_TRANSACTION message and kept only as a redacted detail.
 */
function parseTransaction(xdr: string, networkPassphrase: string, message?: string) {
  try {
    return TransactionBuilder.fromXDR(xdr, networkPassphrase);
  } catch (error) {
    throw causedError('INVALID_SIGNED_XDR', error, 'MALFORMED_TRANSACTION', message);
  }
}

/** Builds a contract invocation, mapping SDK coercion errors to MALFORMED_TRANSACTION. */
function buildOperation<T>(build: () => T): T {
  try {
    return build();
  } catch (error) {
    throw causedError('INVALID_TRANSACTION_PARAMS', error, 'MALFORMED_TRANSACTION');
  }
}

/**
 * Signs and submits a refund. Every failure is a classified SigningError whose
 * message is authored, never raw wallet/RPC text (see lib/signingErrors.ts).
 */
export async function submitRefundTransaction(
  campaignId: string,
  contributor: string,
): Promise<SorobanRefundMetadata> {
  try {
    return await buildAndSubmitRefund(campaignId, contributor);
  } catch (error) {
    throw toSigningError(error, 'REFUND_FAILED');
  }
}

async function buildAndSubmitRefund(
  campaignId: string,
  contributor: string,
): Promise<SorobanRefundMetadata> {
  const config = await getAppConfig();
  const { contractId, networkPassphrase, rpcUrl } = config.soroban;

  if (!contractId || !networkPassphrase || !rpcUrl) {
    throw createSigningError('CONFIG_MISSING', {
      message:
        'Soroban refund configuration is incomplete. Set the contract, network, and RPC settings on the backend.',
    });
  }

  const walletAddress = await requestAccess().catch((error) => {
    throw causedError('FREIGHTER_ACCESS_DENIED', error, 'USER_REJECTED');
  });
  if (!walletAddress) {
    throw createSigningError('FREIGHTER_UNAVAILABLE', {
      message: 'Freighter did not return a wallet address. Unlock Freighter, then reconnect.',
    });
  }

  if (walletAddress !== contributor) {
    throw createSigningError('WALLET_ACCOUNT_MISMATCH', {
      signingErrorClass: 'MALFORMED_TRANSACTION',
      message:
        'The connected Freighter account must match the contributor address entered for the refund.',
    });
  }

  // Verify wallet network matches expected network before proceeding
  await verifyFreighterNetwork(networkPassphrase);

  const server = new rpc.Server(rpcUrl, {
    allowHttp: rpcUrl.startsWith('http://'),
  });

  const sourceAccount = await server.getAccount(walletAddress).catch((error) => {
    throw causedError('SOURCE_ACCOUNT_LOAD_FAILED', error, 'RPC_FAILURE');
  });
  const contract = buildOperation(() => new Contract(contractId));

  let transaction = buildOperation(() =>
    new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase,
    })
      .addOperation(
        contract.call(
          'refund',
          nativeToScVal(BigInt(campaignId), { type: 'u64' }),
          new Address(contributor).toScVal(),
        ),
      )
      .setTimeout(300)
      .build(),
  );

  const simulation = await server.simulateTransaction(transaction).catch((error) => {
    throw createSigningError('SIMULATION_FAILED', {
      signingErrorClass: 'RPC_FAILURE',
      cause: error,
    });
  });
  if (rpc.Api.isSimulationError(simulation)) {
    throw causedError('SIMULATION_FAILED', simulation.error, 'MALFORMED_TRANSACTION');
  }

  transaction = buildOperation(() => rpc.assembleTransaction(transaction, simulation).build());

  let signedXdr: string;
  try {
    signedXdr = await signTransaction(transaction.toXDR(), {
      accountToSign: walletAddress,
      networkPassphrase,
    });
  } catch (error) {
    throw causedError('SIGNING_FAILED', error, 'UNKNOWN');
  }

  const signedTransaction = parseTransaction(
    signedXdr,
    networkPassphrase,
    'Your wallet returned a signature this app could not read. Reconnect the wallet, then try again.',
  );
  const sendResponse = await server.sendTransaction(signedTransaction).catch((error) => {
    throw createSigningError('SUBMISSION_FAILED', {
      signingErrorClass: 'RPC_FAILURE',
      cause: error,
    });
  });

  if (sendResponse.status === 'ERROR' || !sendResponse.hash) {
    throw createSigningError('SUBMISSION_FAILED', {
      signingErrorClass: 'CONTRACT_REJECTED',
      cause: sendResponse.status,
    });
  }

  const finalResponse = await server
    .pollTransaction(sendResponse.hash, { attempts: 15 })
    .catch((error) => {
      throw createSigningError('TRANSACTION_TIMEOUT', {
        signingErrorClass: 'RPC_FAILURE',
        cause: error,
      });
    });
  if (finalResponse.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw createSigningError('TRANSACTION_FAILED', {
      signingErrorClass: 'CONTRACT_REJECTED',
      cause: finalResponse.status,
    });
  }

  const finalResponseAny = finalResponse as {
    ledger?: number;
    createdAt?: number;
    latestLedger?: number;
  };

  return {
    txHash: sendResponse.hash,
    contractId,
    networkPassphrase,
    rpcUrl,
    walletAddress,
    ledger: finalResponseAny.ledger,
    createdAt: finalResponseAny.createdAt,
    latestLedger: finalResponseAny.latestLedger,
  };
}

export const executeSorobanRefund = submitRefundTransaction;

/**
 * Typed contract client instance for interacting with the Soroban GoalVaultContract
 */
export const contractClient = new GoalVaultContract();
