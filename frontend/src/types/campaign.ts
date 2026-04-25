export type CampaignStatus = "open" | "funded" | "claimed" | "failed";

export interface CampaignProgress {
  status: CampaignStatus;
  percentFunded: number;
  remainingAmount: number;
  pledgeCount: number;
  hoursLeft: number;
  canPledge: boolean;
  canClaim: boolean;
  canRefund: boolean;
}

export interface Pledge {
  id: number;
  campaignId: string;
  contributor: string;
  amount: number;
  createdAt: number;
  refundedAt?: number;
  transactionHash?: string;
}

export interface Campaign {
  id: string;
  creator: string;
  title: string;
  description: string;
  assetCode: string;
  targetAmount: number;
  pledgedAmount: number;
  deadline: number;
  createdAt: number;
  claimedAt?: number;
  deletedAt?: number;
  isDeleted?: boolean;
  progress: CampaignProgress;
  pledges?: Pledge[];
  metadata?: {
    imageUrl?: string;
    externalLink?: string;
  };
}

export interface BlockchainMetadata {
  txHash?: string;
  ledgerNumber?: number;
  ledgerCloseTime?: number;
  eventIndex?: number;
  contractId?: string;
  source?: "local" | "soroban";
}

export interface CampaignEvent {
  id: number;
  campaignId: string;
  eventType: "created" | "pledged" | "claimed" | "refunded";
  timestamp: number;
  actor?: string;
  amount?: number;
  metadata?: Record<string, unknown> & {
    pending?: boolean;
    txHash?: string;
    onChain?: boolean;
    reconciled?: boolean;
  };
  blockchainMetadata?: BlockchainMetadata;
}

export interface SorobanRefundMetadata {
  txHash: string;
  contractId: string;
  networkPassphrase: string;
  rpcUrl: string;
  walletAddress: string;
  ledger?: number;
  createdAt?: number;
  latestLedger?: number;
}

export interface RefundReconciliationPayload {
  contributor: string;
  soroban: SorobanRefundMetadata;
}

export interface CreateCampaignPayload {
  creator: string;
  title: string;
  description: string;
  assetCode: string;
  targetAmount: number;
  deadline: number;
  metadata?: {
    imageUrl?: string;
    externalLink?: string;
  };
}

export interface CreatePledgePayload {
  contributor: string;
  amount: number;
}

export interface ReconcilePledgePayload extends CreatePledgePayload {
  transactionHash: string;
  confirmedAt?: number;
}

export interface AppConfig {
  allowedAssets: string[];
  soroban: {
    enabled: boolean;
    contractId?: string;
    networkPassphrase: string;
    rpcUrl: string;
  };
  sorobanRpcUrl: string;
  contractId: string;
  networkPassphrase: string;
  contractAmountDecimals: number;
  walletIntegrationReady: boolean;
}

export interface WalletConnection {
  publicKey: string;
  networkPassphrase?: string;
  sorobanRpcUrl?: string;
}

export interface PledgeTransactionResult {
  transactionHash: string;
  confirmedAt: number;
}

export interface OpenIssue {
  id: string;
  title: string;
  labels: string[];
  summary: string;
  complexity: "Trivial" | "Medium" | "High";
  points: 100 | 150 | 200;
}

export interface ApiError {
  message: string;
  code?: string;
  details?: Array<{ field: string; message: string }>;
  requestId?: string;
}
