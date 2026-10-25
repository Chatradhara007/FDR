import { Router } from 'express';
import { clockAdvanceSchema, clockSetSchema } from '@fdr/shared';
import { asyncHandler } from '../middleware/asyncHandler';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import { validate } from '../middleware/validate';
import * as clockService from '../services/clockService';

export const clockRouter = Router();

clockRouter.get(
  '/clock',
  authenticate,
  requireRole('institution', 'officer', 'approver', 'admin', 'auditor'),
  asyncHandler(async (_req, res) => {
    res.json(await clockService.getClock());
  }),
);

clockRouter.post(
  '/clock/advance',
  authenticate,
  requireRole('admin'),
  validate({ body: clockAdvanceSchema }),
  asyncHandler(async (req, res) => {
    res.json(await clockService.advance(req.user!, req.body.days));
  }),
);

clockRouter.post(
  '/clock/set',
  authenticate,
  requireRole('admin'),
  validate({ body: clockSetSchema }),
  asyncHandler(async (req, res) => {
    res.json(await clockService.setDate(req.user!, req.body.date));
  }),
);

clockRouter.post(
  '/clock/reset',
  authenticate,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    res.json(await clockService.reset(req.user!));
  }),
);
