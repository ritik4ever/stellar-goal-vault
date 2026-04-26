import { getNetworkDetails, requestAccess, signTransaction } from "@stellar/freighter-api";
import {
  Address,
  BASE_FEE,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  rpc,
} from "@stellar/stellar-sdk";
import { getAppConfig } from "./api";
import { SorobanRefundMetadata } from "../types/campaign";

function stringifyErrorDetails(value: unknown): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return "Unknown Soroban RPC error.";
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

export async function submitRefundTransaction(
  campaignId: string,
  contributor: string,
): Promise<SorobanRefundMetadata> {
  const config = await getAppConfig();
  const { contractId, networkPassphrase, rpcUrl } = config.soroban;

  if (!contractId || !networkPassphrase || !rpcUrl) {
    throw new Error(
      "Soroban refund configuration is incomplete. Set the contract, network, and RPC settings on the backend.",
    );
  }

  const walletAddress = await requestAccess();
  if (!walletAddress) {
    throw new Error("Freighter did not return a wallet address for this refund.");
  }

  if (walletAddress !== contributor) {
    throw new Error(
      "The connected Freighter account must match the contributor address entered for the refund.",
    );
  }

  const networkDetails = await getNetworkDetails().catch(() => null);
  if (
    networkDetails?.networkPassphrase &&
    networkDetails.networkPassphrase !== networkPassphrase
  ) {
    throw new Error(
      "Freighter is connected to a different Stellar network than the configured Soroban refund flow.",
    );
  }

  const server = new rpc.Server(rpcUrl, {
    allowHttp: rpcUrl.startsWith("http://"),
  });

  const sourceAccount = await server.getAccount(walletAddress);
  const contract = new Contract(contractId);

  let transaction = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      contract.call(
        "refund",
        nativeToScVal(BigInt(campaignId), { type: "u64" }),
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

  if (sendResponse.status === "ERROR" || !sendResponse.hash) {
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
