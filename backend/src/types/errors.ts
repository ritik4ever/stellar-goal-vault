import { Request } from "express";

export interface ApiErrorDetail {
  field: string;
  message: string;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: ApiErrorDetail[];
    requestId?: string;
  };
}

export interface RequestWithId extends Request {
  requestId: string;
}

export interface CampaignListItem {
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
  progress: {
    status: "open" | "funded" | "claimed" | "failed";
    percentFunded: number;
    remainingAmount: number;
    pledgeCount: number;
    hoursLeft: number;
    canPledge: boolean;
    canClaim: boolean;
    canRefund: boolean;
  };
  metadata?: {
    imageUrl?: string;
    externalLink?: string;
  };
}

export class AppError extends Error {
  constructor(
    public message: string,
    public statusCode: number = 500,
    public code: string = "INTERNAL_SERVER_ERROR",
    public details?: ApiErrorDetail[],
  ) {
    super(message);
    this.name = "AppError";
    Object.setPrototypeOf(this, AppError.prototype);
  }
}
