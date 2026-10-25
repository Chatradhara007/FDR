import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import * as authService from '../services/authService';

// Mounted only when DEMO_MODE=true (D17); otherwise these paths fall through to 404.
export const demoRouter = Router();

// Public by design: feeds the login page's "Sign in as" buttons.
demoRouter.get(
  '/demo/users',
  asyncHandler(async (_req, res) => {
    res.json(await authService.listDemoUsers());
  }),
);
