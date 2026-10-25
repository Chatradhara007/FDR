import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { loginSchema } from '@fdr/shared';
import { TooManyRequests } from '../domain/errors';
import { asyncHandler } from '../middleware/asyncHandler';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import { validate } from '../middleware/validate';
import * as authService from '../services/authService';

/** A new router (and limiter store) per app instance, so tests don't share attempt counts. */
export function authRouter(): Router {
  const router = Router();

  // 5 attempts per minute per IP + email (wall time: rate limiting is exempt from the app clock).
  const loginLimiter = rateLimit({
    windowMs: 60_000,
    limit: 5,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? '')}|${String(req.body?.email ?? '').trim().toLowerCase()}`,
    handler: (_req, _res, next) => next(new TooManyRequests('Too many sign-in attempts. Wait a minute and try again.')),
  });

  router.post(
    '/auth/login',
    loginLimiter,
    validate({ body: loginSchema }),
    asyncHandler(async (req, res) => {
      res.json(await authService.login(req.body.email, req.body.password));
    }),
  );

  router.get(
    '/auth/me',
    authenticate,
    requireRole('institution', 'officer', 'approver', 'admin', 'auditor'),
    asyncHandler(async (req, res) => {
      res.json(await authService.me(req.user!.id));
    }),
  );

  return router;
}
