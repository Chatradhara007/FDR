import os from 'node:os';
import path from 'node:path';
import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import type { z } from 'zod';
import {
  instrumentCreateSchema, instrumentListQuerySchema, instrumentPatchSchema,
} from '@fdr/shared';
import { AppError, NotFound, ValidationFailed } from '../domain/errors';
import { asyncHandler } from '../middleware/asyncHandler';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import { validate } from '../middleware/validate';
import * as documentService from '../services/documentService';
import * as instrumentService from '../services/instrumentService';
import { submitInstrument } from '../services/submission';

export const instrumentsRouter = Router();

const ALL_ROLES = ['institution', 'officer', 'approver', 'admin', 'auditor'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Malformed ids are simply "not found" (no hint whether the record exists). */
const checkIds: RequestHandler = (req, _res, next) => {
  for (const key of ['id', 'docId']) {
    const v = req.params[key];
    if (v !== undefined && !UUID.test(v)) return next(new NotFound(key === 'docId' ? 'Document not found' : 'Instrument not found'));
  }
  next();
};

// Uploads land in the OS temp dir under a random name; storage.ts moves them (2.4).
const upload = multer({
  dest: path.join(os.tmpdir(), 'fdr-uploads'),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5 },
}).single('file');

const receiveFile: RequestHandler = (req, res, next) => {
  upload(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(new AppError('FILE_TOO_LARGE', 'Files can be at most 10 MB', [{ field: 'file', message: 'File is larger than 10 MB' }], 422));
      }
      return next(new ValidationFailed([{ field: err.field ?? 'file', message: err.message }]));
    }
    next(err);
  });
};

instrumentsRouter.get(
  '/instruments',
  authenticate,
  requireRole(...ALL_ROLES),
  validate({ query: instrumentListQuerySchema }),
  asyncHandler(async (req, res) => {
    res.json(await instrumentService.listInstruments(req.user!, req.query as unknown as z.output<typeof instrumentListQuerySchema>));
  }),
);

instrumentsRouter.post(
  '/instruments',
  authenticate,
  requireRole('institution'),
  validate({ body: instrumentCreateSchema }),
  asyncHandler(async (req, res) => {
    res.status(201).json(await instrumentService.createDraft(req.user!, req.body));
  }),
);

instrumentsRouter.get(
  '/instruments/:id',
  authenticate,
  requireRole(...ALL_ROLES),
  checkIds,
  asyncHandler(async (req, res) => {
    res.json(await instrumentService.getInstrument(req.user!, req.params.id));
  }),
);

instrumentsRouter.patch(
  '/instruments/:id',
  authenticate,
  requireRole('institution'),
  checkIds,
  validate({ body: instrumentPatchSchema }),
  asyncHandler(async (req, res) => {
    res.json(await instrumentService.editInstrument(req.user!, req.params.id, req.body));
  }),
);

instrumentsRouter.delete(
  '/instruments/:id',
  authenticate,
  requireRole('institution'),
  checkIds,
  asyncHandler(async (req, res) => {
    await instrumentService.deleteDraft(req.user!, req.params.id);
    res.status(204).end();
  }),
);

instrumentsRouter.post(
  '/instruments/:id/submit',
  authenticate,
  requireRole('institution'),
  checkIds,
  asyncHandler(async (req, res) => {
    res.json(await submitInstrument(req.user!, req.params.id));
  }),
);

instrumentsRouter.post(
  '/instruments/:id/documents',
  authenticate,
  requireRole('institution'),
  checkIds,
  receiveFile,
  asyncHandler(async (req, res) => {
    const result = await documentService.uploadDocument(req.user!, req.params.id, req.body?.docType, req.file);
    res.status(201).json(result);
  }),
);

instrumentsRouter.delete(
  '/instruments/:id/documents/:docId',
  authenticate,
  requireRole('institution'),
  checkIds,
  asyncHandler(async (req, res) => {
    await documentService.removeDocument(req.user!, req.params.id, req.params.docId);
    res.status(204).end();
  }),
);

/** RFC 6266: an ASCII fallback plus the UTF-8 name. */
function contentDisposition(kind: 'attachment' | 'inline', filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function sendDocument(kind: 'attachment' | 'inline'): RequestHandler {
  return asyncHandler(async (req, res) => {
    const doc = await documentService.openDocument(req.user!, req.params.id, req.params.docId, kind === 'inline' ? 'preview' : 'download');
    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader('Content-Length', String(doc.sizeBytes));
    res.setHeader('Content-Disposition', contentDisposition(kind, doc.filename));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    await new Promise<void>((resolve, reject) => {
      doc.stream.on('error', reject);
      res.on('finish', resolve);
      res.on('close', resolve);
      doc.stream.pipe(res);
    }).catch((err: unknown) => {
      if (!res.headersSent) throw err;
      res.destroy(err as Error);
    });
  });
}

instrumentsRouter.get(
  '/instruments/:id/documents/:docId/download',
  authenticate,
  requireRole(...ALL_ROLES),
  checkIds,
  sendDocument('attachment'),
);

instrumentsRouter.get(
  '/instruments/:id/documents/:docId/preview',
  authenticate,
  requireRole(...ALL_ROLES),
  checkIds,
  sendDocument('inline'),
);
