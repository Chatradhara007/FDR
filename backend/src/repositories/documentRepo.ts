import type { DocumentInfo } from '@fdr/shared';
import { exec, many, maybeOne, one, type Db } from '../db/pool';

/** API shape plus storage_path (never sent to clients). */
export type DocumentRow = Omit<DocumentInfo, 'uploadedAt'> & { uploadedAt: Date; storagePath: string };

const COLUMNS = `
  d.id, d.instrument_id AS "instrumentId", d.doc_type AS "docType", d.filename, d.storage_path AS "storagePath",
  d.mime_type AS "mimeType", d.size_bytes AS "sizeBytes", d.sha256, d.uploaded_by AS "uploadedBy",
  d.uploaded_at AS "uploadedAt"`;

export interface NewDocument {
  instrumentId: string;
  docType: string;
  filename: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  uploadedBy: string;
  uploadedAt: Date;
}

export async function insertDocument(db: Db, d: NewDocument): Promise<DocumentRow> {
  return one<DocumentRow>(
    db,
    `WITH ins AS (
       INSERT INTO documents (instrument_id, doc_type, filename, storage_path, mime_type, size_bytes, sha256, uploaded_by, uploaded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *)
     SELECT ${COLUMNS} FROM ins d`,
    [d.instrumentId, d.docType, d.filename, d.storagePath, d.mimeType, d.sizeBytes, d.sha256, d.uploadedBy, d.uploadedAt],
  );
}

export async function listLiveDocuments(db: Db, instrumentId: string): Promise<DocumentRow[]> {
  return many<DocumentRow>(
    db,
    `SELECT ${COLUMNS} FROM documents d WHERE d.instrument_id = $1 AND d.deleted_at IS NULL ORDER BY d.uploaded_at, d.id`,
    [instrumentId],
  );
}

/** A live (not deleted) document of this instrument. */
export async function findLiveDocument(db: Db, instrumentId: string, docId: string): Promise<DocumentRow | null> {
  return maybeOne<DocumentRow>(
    db,
    `SELECT ${COLUMNS} FROM documents d WHERE d.id = $1 AND d.instrument_id = $2 AND d.deleted_at IS NULL`,
    [docId, instrumentId],
  );
}

export async function findLiveByChecksum(db: Db, instrumentId: string, sha256: string): Promise<DocumentRow | null> {
  return maybeOne<DocumentRow>(
    db,
    `SELECT ${COLUMNS} FROM documents d
      WHERE d.instrument_id = $1 AND d.sha256 = $2 AND d.deleted_at IS NULL ORDER BY d.uploaded_at, d.id LIMIT 1`,
    [instrumentId, sha256],
  );
}

export async function softDeleteDocument(db: Db, docId: string, by: string, at: Date): Promise<void> {
  await exec(db, 'UPDATE documents SET deleted_at = $2, deleted_by = $3 WHERE id = $1 AND deleted_at IS NULL', [docId, at, by]);
}
