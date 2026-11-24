import { Request } from 'express';

export interface RequestWithId extends Request {
  requestId?: string;
  retryCount?: number;
  retryReason?: string;
  finalOutcome?: string;
}
