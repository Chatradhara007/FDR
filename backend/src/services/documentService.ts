import type { Readable } from 'node:stream';
import { docTypeSchema, type UploadResponse } from '@fdr/shared';
import { getPool, withTransaction } from '../db/pool';
import { actorOf, assertCanSee, type AuthUser } from '../domain/access';
import { recordEvent } from '../domain/audit';
import * as clock from '../domain/clock';
import { AppError, NotFound, ValidationFailed } from '../domain/errors';
import {
  findLiveByChecksum, findLiveDocument, insertDocument, softDeleteDocument, type DocumentRow,
} from '../repositories/documentRepo';
import { findInstrumentById } from '../repositories/instrumentRepo';
import { lockOwnEditable } from './instrumentService';
import { detectFileType, discardUnrecorded, openForRead, removeTemp, saveUpload } from './storage';

export interface IncomingFile {
  /** multer temp file path */
  path: string;
  originalname: string;
}

/** Display-only name: no directories, control characters or quotes; never used in a storage path. */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const clean = base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
  return clean || 'document';
}

function toInfo({ storagePath: _p, ...d }: DocumentRow): UploadResponse['document'] {
  return JSON.parse(JSON.stringify(d)) as UploadResponse['document'];
}

/**
 * 2.4: detect the real type, store the file (outside the transaction), then record it under the
 * instrument lock. Upload only in DRAFT/RETURNED. Same checksum → accepted, `duplicateOf` set.
 */
export async function uploadDocument(
  user: AuthUser,
  instrumentId: string,
  rawDocType: unknown,
  file: IncomingFile | undefined,
): Promise<UploadResponse> {
  const parsed = docTypeSchema.safeParse(rawDocType);
  const issues = [
    ...(file ? [] : [{ field: 'file', message: 'Choose a file to upload' }]),
    ...(parsed.success ? [] : [{ field: 'docType', message: 'Choose a document type' }]),
  ];
  if (!file || !parsed.success) {
    if (file) await removeTemp(file.path);
    throw new ValidationFailed(issues);
  }
  const docType = parsed.data;
  // Visibility first, so a stranger learns nothing and nothing is stored for them.
  try {
    const inst = await findInstrumentById(getPool(), instrumentId);
    if (!inst) throw new NotFound('Instrument not found');
    assertCanSee(user, inst);
  } catch (err) {
    await removeTemp(file.path);
    throw err;
  }
  const type = await detectFileType(file.path);
  if (!type) {
    await removeTemp(file.path);
    throw new AppError('UNSUPPORTED_FILE_TYPE', 'Only PDF, PNG and JPEG files can be uploaded', [
      { field: 'file', message: 'This file is not a PDF, PNG or JPEG (checked from its contents, not its name)' },
    ], 422);
  }
  const stored = await saveUpload(file.path, instrumentId, type.ext);
  try {
    return await withTransaction(async (tx) => {
      await lockOwnEditable(tx, user, instrumentId, 'changed');
      const duplicate = await findLiveByChecksum(tx, instrumentId, stored.sha256);
      const doc = await insertDocument(tx, {
        instrumentId,
        docType,
        filename: sanitizeFilename(file.originalname),
        storagePath: stored.storagePath,
        mimeType: type.mime,
        sizeBytes: stored.size,
        sha256: stored.sha256,
        uploadedBy: user.id,
        uploadedAt: await clock.now(tx),
      });
      await recordEvent(tx, {
        actor: actorOf(user), action: 'DOCUMENT_UPLOADED', entityType: 'document', entityId: doc.id, instrumentId,
        after: { docType, filename: doc.filename, sizeBytes: doc.sizeBytes, sha256: doc.sha256, duplicateOf: duplicate?.id ?? null },
      });
      return { document: toInfo(doc), duplicateOf: duplicate?.id ?? null };
    });
  } catch (err) {
    await discardUnrecorded(stored.storagePath);
    throw err;
  }
}

/** D15: soft delete while DRAFT/RETURNED; the file stays on disk as evidence. */
export async function removeDocument(user: AuthUser, instrumentId: string, docId: string): Promise<void> {
  await withTransaction(async (tx) => {
    await lockOwnEditable(tx, user, instrumentId, 'changed');
    const doc = await findLiveDocument(tx, instrumentId, docId);
    if (!doc) throw new NotFound('Document not found');
    await softDeleteDocument(tx, docId, user.id, await clock.now(tx));
    await recordEvent(tx, {
      actor: actorOf(user), action: 'DOCUMENT_REMOVED', entityType: 'document', entityId: docId, instrumentId,
      before: { docType: doc.docType, filename: doc.filename, sha256: doc.sha256 },
    });
  });
}

export interface OpenedDocument {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  stream: Readable;
}

/** Authorise, log DOCUMENT_ACCESSED, then hand back a stream (2.4). */
export async function openDocument(
  user: AuthUser,
  instrumentId: string,
  docId: string,
  mode: 'download' | 'preview',
): Promise<OpenedDocument> {
  const doc = await withTransaction(async (tx) => {
    const inst = await findInstrumentById(tx, instrumentId);
    if (!inst) throw new NotFound('Instrument not found');
    assertCanSee(user, inst);
    const d = await findLiveDocument(tx, instrumentId, docId);
    if (!d) throw new NotFound('Document not found');
    await recordEvent(tx, {
      actor: actorOf(user), action: 'DOCUMENT_ACCESSED', entityType: 'document', entityId: docId, instrumentId,
      after: { mode, role: user.role },
    });
    return d;
  });
  return { filename: doc.filename, mimeType: doc.mimeType, sizeBytes: doc.sizeBytes, stream: openForRead(doc.storagePath) };
}
