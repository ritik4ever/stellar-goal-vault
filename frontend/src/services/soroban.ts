import { getNetworkDetails, requestAccess, signTransaction } from '@stellar/freighter-api';
import {
  Address,
  BASE_FEE,
  Contract,
  Transaction,
  TransactionBuilder,
  nativeToScVal,
  rpc,
} from '@stellar/stellar-sdk';
import { getAppConfig } from './api';
import {
  ConfirmedTransaction,
  resumeSubmittedTransaction,
  sendAndConfirmTransaction,
} from './freighter';
import { SorobanRefundMetadata } from '../types/campaign';
import { GoalVaultContract } from '../generated';
import { verifyFreighterNetwork } from './freighter';
import {
  SigningErrorClass,
  classifyCause,
  createSigningError,
  toSigningError,
} from '../lib/signingErrors';

function causedError(code: string, cause: unknown, fallbackClass: SigningErrorClass) {
  return createSigningError(code, {
    signingErrorClass: classifyCause(cause, fallbackClass),
    cause,
  });
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
  const contract = new Contract(contractId);

  let transaction = new TransactionBuilder(sourceAccount, {
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
    .build();

  const simulation = await server.simulateTransaction(transaction).catch((error) => {
    throw createSigningError('SIMULATION_FAILED', {
      signingErrorClass: 'RPC_FAILURE',
      cause: error,
    });
  });
  if (rpc.Api.isSimulationError(simulation)) {
    throw causedError('SIMULATION_FAILED', simulation.error, 'MALFORMED_TRANSACTION');
  }

  transaction = rpc.assembleTransaction(transaction, simulation).build();

  let signedXdr: string;
  try {
    signedXdr = await signTransaction(transaction.toXDR(), {
      accountToSign: walletAddress,
      networkPassphrase,
    });
  } catch (error) {
    throw causedError('SIGNING_FAILED', error, 'UNKNOWN');
  }

  const signedTransaction = TransactionBuilder.fromXDR(signedXdr, networkPassphrase) as Transaction;
  const confirmed = await sendAndConfirmTransaction(server, signedTransaction, 'SUBMISSION_FAILED');

  return toRefundReceipt(confirmed, { contractId, networkPassphrase, rpcUrl, walletAddress });
}

function toRefundReceipt(
  confirmed: ConfirmedTransaction,
  context: { contractId: string; networkPassphrase: string; rpcUrl: string; walletAddress: string },
): SorobanRefundMetadata {
  return {
    txHash: confirmed.transactionHash,
    ...context,
    ledger: confirmed.ledger,
    createdAt: confirmed.confirmedAt,
    latestLedger: confirmed.latestLedger,
  };
}

/**
 * Resumes a refund transaction from a previous retryable attempt without
 * signing a new one. See `resumeSubmittedTransaction`.
 */
export async function resumeRefundTransaction(
  submittedTransaction: string,
  contributor: string,
): Promise<SorobanRefundMetadata> {
  const config = await getAppConfig();
  const { contractId, networkPassphrase, rpcUrl } = config.soroban;

  if (!contractId || !networkPassphrase || !rpcUrl) {
    throw new Error(
      'Soroban refund configuration is incomplete. Set the contract, network, and RPC settings on the backend.',
    );
  }

  const confirmed = await resumeSubmittedTransaction(
    rpcUrl,
    networkPassphrase,
    submittedTransaction,
  );
  return toRefundReceipt(confirmed, {
    contractId,
    networkPassphrase,
    rpcUrl,
    walletAddress: contributor,
  });
}

export const executeSorobanRefund = submitRefundTransaction;

/**
 * Typed contract client instance for interacting with the Soroban GoalVaultContract
 */
export const contractClient = new GoalVaultContract();
