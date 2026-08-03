import { Request } from 'express';

export interface RequestWithId extends Request {
  requestId?: string;
}
