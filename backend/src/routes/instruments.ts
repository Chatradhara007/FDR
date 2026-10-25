import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import { NotFound } from '../domain/errors';
import * as instrumentService from '../services/instrumentService';

export const instrumentsRouter = Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

instrumentsRouter.get(
  '/instruments/:id',
  authenticate,
  requireRole('institution', 'officer', 'approver', 'admin', 'auditor'),
  asyncHandler(async (req, res) => {
    if (!UUID.test(req.params.id)) throw new NotFound('Instrument not found');
    res.json(await instrumentService.getInstrument(req.user!, req.params.id));
  }),
);
