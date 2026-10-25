import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { getHealth } from '../services/healthService';

// Public by design: used by the login screen, Docker and monitoring before anyone signs in.
export const healthRouter = Router();

healthRouter.get(
  '/health',
  asyncHandler(async (_req, res) => {
    res.json(await getHealth());
  }),
);
