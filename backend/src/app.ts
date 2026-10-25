import cors from 'cors';
import express, { Router, type Express } from 'express';
import { config } from './config';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { requestId } from './middleware/requestId';
import { authRouter } from './routes/auth';
import { clockRouter } from './routes/clock';
import { demoRouter } from './routes/demo';
import { healthRouter } from './routes/health';
import { instrumentsRouter } from './routes/instruments';

export interface AppOptions {
  /** Tests mount throwaway routes under /api/v1 here. */
  mountTestRoutes?: (router: Router) => void;
}

export function createApp(options: AppOptions = {}): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestId);
  app.use(cors({ origin: config.frontendOrigins, exposedHeaders: ['X-Request-Id', 'Content-Disposition'] }));
  app.use(express.json({ limit: '1mb' }));

  const api = Router();
  api.use(healthRouter);
  api.use(authRouter());
  api.use(clockRouter);
  api.use(instrumentsRouter);
  if (config.demoMode) api.use(demoRouter);
  options.mountTestRoutes?.(api);
  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
