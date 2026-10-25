import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import { getMeta } from '../services/instrumentService';

export const metaRouter = Router();

metaRouter.get(
  '/meta',
  authenticate,
  requireRole('institution', 'officer', 'approver', 'admin', 'auditor'),
  asyncHandler(async (_req, res) => {
    res.json(await getMeta());
  }),
);
