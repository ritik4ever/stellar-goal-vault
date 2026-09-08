import { getNetworkDetails, requestAccess, signTransaction } from '@stellar/fregher-api';
import {
  Address,
  BASE_FEE,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
} from '@stellar/stellar-sdk';
import { getAppConfig } from './api';
import { SorobanRefundMetadata } from '../types/campaign';
import { GoalVaultContract } from '../generated';

function stringifyErrorDetails(value: unknown): string {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return 'Unknown Soroban RPC error.';
  }
}

function getSimulationErrorMessage(simulation: unknown): string {
  const raw = simulation as { error?: unknown };
  return `Soroban simulation failed: ${stringifyErrorDetails(raw.error ?? simulation)}`;
}

function getSendErrorMessage(response: unknown): string {
  const raw = response as { errorResult?: unknown; status?: string };
  return `Soroban refund submission failed: ${stringifyErrorDetails(raw.errorResult ?? raw.status ?? response)}`;
}

function getFinalStatusErrorMessage(response: unknown): string {
  const raw = response as { status?: string; errorResultXdr?: unknown };
  return `Soroban refund was not confirmed: ${stringifyErrorDetails(raw.errorResultXdr ?? raw.status ?? response)}`;
}

function getCampaignSendErrorMessage(response: unknown): string {
  const raw = response as { errorResult?: unknown; status?: string };
  return `Soroban campaign submission failed: ${stringifyErrorDetails(raw.errorResult ?? raw.status ?? response)}`;
}

function getCampaignFinalStatusErrorMessage(response: unknown): string {
  const raw = response as { status?: string; errorResultXdr?: unknown };
  return `Soroban campaign was not confirmed: ${stringifyErrorDetails(raw.errorResultXdr
    ?? raw.status ?? response)}`;
}

export async function submitRefundTransaction(
  campaignId: string,
  contributor: string,
): Promise<SorobanRefundMetadata> {
  const config = await getAppConfig();
  const { contractId, networkPassphrase, rpcUrl } = config.soroban;

  if (!contractId || !networkPassphrase || !rpcUrl) {
    throw new Error(
      'Soroban refund configuration is incomplete. Set the contract, network, and RPC settings on the backend.',
    );
  }

  const walletAddress = await requestAccess();
  if (!walletAddress) {
    throw new Error('Freighter did not return a wallet address for this refund.');
  }

  if (walletAddress !== contributor) {
    throw new Error(
      'The connected Freighter account must match the contributor address entered for the refund.',
    );
  }

  const networkDetails = await getNetworkDetails().catch(() => null);
  if (networkDetails?.networkPassphrase && networkDetails.networkPassphrase !== networkPassphrase) {
    throw new Error(
      'Freighter is connected to a different Stellar network than the configured Soroban refund flow.',
    );
  }

  const server = new rpc.Server(rpcUrl, {
    allowHttp: rpcUrl.startsWith('http://'),
  });

  const sourceAccount = await server.getAccount(walletAddress);
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

  const simulation = await server.simulateTransaction(transaction);
  if (rpc.Api.isSimulationError(simulation)) {
    throw new Error(getSimulationErrorMessage(simulation));
  }

  transaction = rpc.assembleTransaction(transaction, simulation).build();

  const signedXdr = await signTransaction(transaction.toXDR(), {
    accountToSign: walletAddress,
    networkPassphrase,
  });

  const signedTransaction = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
  const sendResponse = await server.sendTransaction(signedTransaction);

  if (sendResponse.status === 'ERROR' || !sendResponse.hash) {
    throw new Error(getSendErrorMessage(sendResponse));
  }

  const finalResponse = await server.pollTransaction(sendResponse.hash, { attempts: 15 });
  if (finalResponse.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(getFinalStatusErrorMessage(finalResponse));
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

// ============== New: Campaign Categories / Tags ==============

export interface CreateCampaignRequest {
  title: string;
  description: string;
  targetAmount: bigint;
  deadline: bigint;
  tags: string[]; // up to 3 tags
  recipient?: string;
}

export interface CreateCampaignResult {
  txHash: string;
  campaignId: string;
  ledger?: number;
  createdAt?: number;
  latestLedger?: number;
}

/**
 * Read the allowlisted category tags from the contract.
 */
export async function fetchCategories(): Promise<string[]> {
  const config = await getAppConfig();
  const { contractId, networkPassphrase, rpcUrl } = config.soroban;

  if (!contractId || !networkPassphrase || !rpcUrl) {
    throw new Error('Soroban configuration is incomplete for fetching categories.');
  }

  const walletAddress = await requestAccess();
  if (!walletAddress) {
    throw new Error('Freighter did not return a wallet address for fetching categories.');
  }

  const server = new rpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith('http://') });
  const sourceAccount = await server.getAccount(walletAddress);
  const contract = new Contract(contractId);

  const transaction = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(contract.call('get_categories'))
    .setTimeout(300)
    .build();

  const simulation = await server.simulateTransaction(transaction);
  if (rpc.Api.isSimulationError(simulation)) {
    throw new Error(getSimulationErrorMessage(simulation));
  }

  const returnValue = simulation.result?.retval;
  if (!returnValue) {
    throw new Error('Soroban simulation returned no value for categories.');
  }

  return scValToNative(returnValue) as string[];
}

/**
 * Fetch campaign IDs that belong to a given category.
 */
export async function getCampaignsByCategory(category: string): Promise<string[]> {
  const config = await getAppConfig();
  const { contractId, networkPassphrase, rpcUrl } = config.soroban;

  if (!contractId || !networkPassphrase || !rpcUrl) {
    throw new Error('Soroban configuration is incomplete for fetching campaigns by category.');
  }

  const walletAddress = await requestAccess();
  if (!walletAddress) {
    throw new Error('Freighter did not return a wallet address for fetching campaigns.');
  }

  const server = new rpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith('http://') });
  const sourceAccount = await server.getAccount(walletAddress);
  const contract = new Contract(contractId);

  const transaction = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(contract.call(
      'get_campaigns_by_category',
      nativeToScVal(category),
    ))
    .setTimeout(300)
    .build();

  const simulation = await server.simulateTransaction(transaction);
  if (rpc.Api.isSimulationError(simulation)) {
    throw new Error(getSimulationErrorMessage(simulation));
  }

  const returnValue = simulation.result?.retval;
  if (!returnValue) {
    throw new Error('Soroban simulation returned no value for campaigns.');
  }

  const campaignIds = scValToNative(returnValue) as Array<bigint | number>;
  return campaignIds.map(id => id.toString());
}

/**
 * Create a new campaign with up to 3 category tags.
 */
export async function createCampaign(
  input: CreateCampaignRequest,
): Promise<CreateCampaignResult> {
  const config = await getAppConfig();
  const { contractId, networkPassphrase, rpcUrl } = config.soroban;

  if (!contractId || !networkPassphrase || !rpcUrl) {
    throw new Error('Soroban campaign creation configuration is incomplete.');
  }

  const walletAddress = await requestAccess();
  if (!walletAddress) {
    throw new Error('Freighter did not return a wallet address for creating a campaign.');
  }

  const server = new rpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith('http://') });
  const sourceAccount = await server.getAccount(walletAddress);
  const contract = new Contract(contractId);

  // Build the create_campaign arguments. The contract expects:
  // (recipient: Address, title: String, description: String, target: i128, deadline: u64, tags: Vec<String>)
  const recipient = input.recipient ?? walletAddress;
  const args = [
    new Address(recipient).toScVal(),
    nativeToScVal(input.title),
    nativeToScVal(input.description),
    nativeToScVal(input.targetAmount, { type: 'i128' }),
    nativeToScVal(input.deadline, { type: 'u64' }),
    nativeToScVal(input.tags),
  ];

  let transaction = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(contract.call('create_campaign', ...args))
    .setTimeout(300)
    .build();

  const simulation = await server.simulateTransaction(transaction);
  if (rpc.Api.isSimulationError(simulation)) {
    throw new Error(getSimulationErrorMessage(simulation));
  }

  transaction = rpc.assembleTransaction(transaction, simulation).build();

  const signedXdr = await signTransaction(transaction.toXDR(), {
    accountToSign: walletAddress,
    networkPassphrase,
  });

  const signedTransaction = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
  const sendResponse = await server.sendTransaction(signedTransaction);

  if (sendResponse.status === 'ERROR' || !sendResponse.hash) {
    throw new Error(getCampaignSendErrorMessage(sendResponse));
  }

  const finalResponse = await server.pollTransaction(sendResponse.hash, { attempts: 15 });
  if (finalResponse.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(getCampaignFinalStatusErrorMessage(finalResponse));
  }

  // The contract likely returns the new campaign id via retval.
  const retval = simulation.result?.retval;
  const campaignId = retval ? (scValToNative(retval) as bigint).toString() : '';

  const finalResponseAny = finalResponse as {
    ledger?: number;
    createdAt?: number;
    latestLedger?: number;
  };

  return {
    txHash: sendResponse.hash,
    campaignId,
    ledger: finalResponseAny.ledger,
    createdAt: finalResponseAny.createdAt,
    latestLedger: finalResponseAny.latestLedger,
  };
}

/**
 * Typed contract client instance for interacting with the Soroban GoalVaultContract
 */
export const contractClient = new GoalVaultContract();
