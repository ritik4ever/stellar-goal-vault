import {
  getNetworkDetails,
  isConnected,
  requestAccess,
  signTransaction,
} from "@stellar/freighter-api";
import {
  Address,
  BASE_FEE,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  rpc,
} from "@stellar/stellar-sdk";
import { AppConfig, PledgeTransactionResult, WalletConnection } from "../types/campaign";

type AppErrorLike = Error & { code?: string };

const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
const MAINNET_PASSPHRASE = "Public Global Stellar Network ; September 2015";

function buildError(code: string, message: string): AppErrorLike {
  const error = new Error(message) as AppErrorLike;
  error.code = code;
  return error;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  return fallback;
}

function getRpcServer(rpcUrl: string): rpc.Server {
  return new rpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith("http://") });
}

function networkLabel(passphrase: string | undefined): string {
  if (!passphrase) {
    return "unknown network";
  }
  if (passphrase === TESTNET_PASSPHRASE) {
    return "Stellar Testnet";
  }
  if (passphrase === MAINNET_PASSPHRASE) {
    return "Stellar Mainnet";
  }
  return "the configured network";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export function amountToContractUnits(amount: number, decimals: number): bigint {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw buildError("INVALID_AMOUNT", "Pledge amount must be greater than zero.");
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 12) {
    throw buildError("INVALID_DECIMALS", "Invalid contract amount decimals configuration.");
  }

  const factor = 10 ** decimals;
  const scaled = amount * factor;
  const rounded = Math.round(scaled);
  if (Math.abs(scaled - rounded) > 1e-8) {
    throw buildError(
      "INVALID_AMOUNT_PRECISION",
      `Amount must use no more than ${decimals} decimal place${decimals === 1 ? "" : "s"}.`,
    );
  }

  return BigInt(rounded);
}

export async function connectFreighterWallet(
  expectedNetworkPassphrase: string,
): Promise<WalletConnection> {
  const connected = await isConnected();
  if (!connected) {
    throw buildError(
      "FREIGHTER_UNAVAILABLE",
      "Freighter was not detected. Install or unlock the extension and try again.",
    );
  }

  let publicKey: string;
  try {
    publicKey = await requestAccess();
  } catch (error) {
    throw buildError(
      "FREIGHTER_ACCESS_DENIED",
      getErrorMessage(error, "Freighter access was rejected."),
    );
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

  if (
    details?.networkPassphrase &&
    details.networkPassphrase !== expectedNetworkPassphrase
  ) {
    throw buildError(
      "FREIGHTER_NETWORK_MISMATCH",
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
    const result = await server.getTransaction(transactionHash);
    if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      return {
        transactionHash,
        confirmedAt: result.createdAt,
      };
    }
    if (result.status === rpc.Api.GetTransactionStatus.FAILED) {
      throw buildError(
        "TRANSACTION_FAILED",
        `The network rejected transaction ${transactionHash}.`,
      );
    }
    await sleep(1200);
  }

  throw buildError(
    "TRANSACTION_TIMEOUT",
    `Transaction ${transactionHash} was submitted but did not confirm before the UI timeout.`,
  );
}

export async function submitFreighterClaim(params: {
  campaignId: string;
  creator: string;
  config: AppConfig;
  onPreview?: (preview: {
    operation: string;
    amount?: number;
    contract: string;
    xdr: string;
  }) => Promise<boolean>;
}): Promise<PledgeTransactionResult> {
  const { campaignId, creator, config } = params;

  if (!config.contractId || !config.sorobanRpcUrl) {
    throw buildError(
      "CONFIG_MISSING",
      "Wallet signing is not configured yet. Set CONTRACT_ID and SOROBAN_RPC_URL on the backend.",
    );
  }

  const server = getRpcServer(config.sorobanRpcUrl);
  const sourceAccount = await server.getAccount(creator).catch((error) => {
    throw buildError(
      "SOURCE_ACCOUNT_LOAD_FAILED",
      getErrorMessage(error, "Unable to load the creator account from Soroban RPC."),
    );
  });

  const operation = new Contract(config.contractId).call(
    "claim",
    nativeToScVal(BigInt(campaignId), { type: "u64" }),
    Address.fromString(creator).toScVal(),
  );

  const transaction = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(operation)
    .setTimeout(60)
    .build();

  const simulation = await server.simulateTransaction(transaction).catch((error) => {
    throw buildError(
      "SIMULATION_FAILED",
      getErrorMessage(error, "Unable to simulate the claim transaction."),
    );
  });

  if ("error" in simulation) {
    throw buildError("SIMULATION_FAILED", `Simulation failed: ${simulation.error}`);
  }

  if ("restorePreamble" in simulation) {
    throw buildError(
      "STATE_RESTORE_REQUIRED",
      "The contract state is archived and must be restored before claiming.",
    );
  }

  const preparedTransaction = await server.prepareTransaction(transaction).catch((error) => {
    throw buildError(
      "SIMULATION_PREPARE_FAILED",
      getErrorMessage(error, "Failed to prepare the simulated claim transaction."),
    );
  });

  if (params.onPreview) {
    const isApproved = await params.onPreview({
      operation: "claim",
      contract: config.contractId,
      xdr: preparedTransaction.toXDR(),
    });
    if (!isApproved) {
      throw buildError("USER_CANCELLED", "User cancelled the transaction from the preview panel.");
    }
  }

  let signedXdr: string;
  try {
    signedXdr = await signTransaction(preparedTransaction.toXDR(), {
      accountToSign: creator,
      networkPassphrase: config.networkPassphrase,
    });
  } catch (error) {
    throw buildError(
      "SIGNING_FAILED",
      getErrorMessage(error, "Freighter rejected or failed to sign the claim transaction."),
    );
  }

  if (!signedXdr) {
    throw buildError("SIGNING_FAILED", "Freighter did not return a signed transaction.");
  }

  const signedTransaction = TransactionBuilder.fromXDR(signedXdr, config.networkPassphrase);
  const sendResult = await server.sendTransaction(signedTransaction).catch((error) => {
    throw buildError(
      "SUBMISSION_FAILED",
      getErrorMessage(error, "Failed to submit the signed claim transaction to Soroban RPC."),
    );
  });

  if (sendResult.status === "ERROR") {
    throw buildError(
      "CONTRACT_CALL_FAILED",
      `Soroban RPC rejected the claim transaction ${sendResult.hash}.`,
    );
  }

  if (sendResult.status === "TRY_AGAIN_LATER") {
    throw buildError(
      "SUBMISSION_RETRY",
      "Soroban RPC asked the client to retry claim submission later.",
    );
  }

  return waitForTransaction(server, sendResult.hash);
}

export async function submitFreighterPledge(params: {
  campaignId: string;
  contributor: string;
  amount: number;
  config: AppConfig;
  onPreview?: (preview: {
    operation: string;
    amount?: number;
    contract: string;
    xdr: string;
  }) => Promise<boolean>;
}): Promise<PledgeTransactionResult> {
  const { campaignId, contributor, amount, config } = params;

  if (!config.contractId || !config.sorobanRpcUrl) {
    throw buildError(
      "CONFIG_MISSING",
      "Wallet signing is not configured yet. Set CONTRACT_ID and SOROBAN_RPC_URL on the backend.",
    );
  }

  const server = getRpcServer(config.sorobanRpcUrl);
  const amountUnits = amountToContractUnits(amount, config.contractAmountDecimals);
  const sourceAccount = await server.getAccount(contributor).catch((error) => {
    throw buildError(
      "SOURCE_ACCOUNT_LOAD_FAILED",
      getErrorMessage(error, "Unable to load the contributor account from Soroban RPC."),
    );
  });

  const operation = new Contract(config.contractId).call(
    "contribute",
    nativeToScVal(BigInt(campaignId), { type: "u64" }),
    Address.fromString(contributor).toScVal(),
    nativeToScVal(amountUnits, { type: "i128" }),
  );

  const transaction = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(operation)
    .setTimeout(60)
    .build();

  const simulation = await server.simulateTransaction(transaction).catch((error) => {
    throw buildError(
      "SIMULATION_FAILED",
      getErrorMessage(error, "Unable to simulate the pledge transaction."),
    );
  });

  if ("error" in simulation) {
    throw buildError(
      "SIMULATION_FAILED",
      `Simulation failed: ${simulation.error}`,
    );
  }

  if ("restorePreamble" in simulation) {
    throw buildError(
      "STATE_RESTORE_REQUIRED",
      "The contract state is archived and must be restored before pledging.",
    );
  }

  const preparedTransaction = await server.prepareTransaction(transaction).catch((error) => {
    throw buildError(
      "SIMULATION_PREPARE_FAILED",
      getErrorMessage(error, "Failed to prepare the simulated transaction."),
    );
  });

  if (params.onPreview) {
    const isApproved = await params.onPreview({
      operation: "contribute",
      amount: params.amount,
      contract: config.contractId,
      xdr: preparedTransaction.toXDR(),
    });
    if (!isApproved) {
      throw buildError("USER_CANCELLED", "User cancelled the transaction from the preview panel.");
    }
  }

  let signedXdr: string;
  try {
    signedXdr = await signTransaction(preparedTransaction.toXDR(), {
      accountToSign: contributor,
      networkPassphrase: config.networkPassphrase,
    });
  } catch (error) {
    throw buildError(
      "SIGNING_FAILED",
      getErrorMessage(error, "Freighter rejected or failed to sign the transaction."),
    );
  }

  if (!signedXdr) {
    throw buildError("SIGNING_FAILED", "Freighter did not return a signed transaction.");
  }

  const signedTransaction = TransactionBuilder.fromXDR(
    signedXdr,
    config.networkPassphrase,
  );
  const sendResult = await server.sendTransaction(signedTransaction).catch((error) => {
    throw buildError(
      "SUBMISSION_FAILED",
      getErrorMessage(error, "Failed to submit the signed transaction to Soroban RPC."),
    );
  });

  if (sendResult.status === "ERROR") {
    throw buildError(
      "SUBMISSION_FAILED",
      `Soroban RPC rejected the transaction ${sendResult.hash}.`,
    );
  }

  if (sendResult.status === "TRY_AGAIN_LATER") {
    throw buildError(
      "SUBMISSION_RETRY",
      "Soroban RPC asked the client to retry transaction submission later.",
    );
  }

  return waitForTransaction(server, sendResult.hash);
}
