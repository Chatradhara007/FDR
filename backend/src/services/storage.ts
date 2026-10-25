import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileTypeFromFile } from 'file-type';
import { config } from '../config';

// The only module that touches uploaded files (2.4). Phase 8 adds encryption at rest here,
// without changing callers. Paths never contain the original filename.

export interface StoredFile {
  /** Relative to STORAGE_DIR: '<instrumentId>/<uuid>.<ext>'. */
  storagePath: string;
  sha256: string;
  size: number;
}

export interface DetectedType {
  ext: 'pdf' | 'png' | 'jpg';
  mime: 'application/pdf' | 'image/png' | 'image/jpeg';
}

const ALLOWED: Record<string, DetectedType> = {
  'application/pdf': { ext: 'pdf', mime: 'application/pdf' },
  'image/png': { ext: 'png', mime: 'image/png' },
  'image/jpeg': { ext: 'jpg', mime: 'image/jpeg' },
};

/** Real type from magic bytes (never the extension or the browser's header); null when not PDF/PNG/JPEG. */
export async function detectFileType(tmpPath: string): Promise<DetectedType | null> {
  const t = await fileTypeFromFile(tmpPath);
  return (t && ALLOWED[t.mime]) ?? null;
}

function resolveStored(storagePath: string): string {
  const root = path.resolve(config.storageDir);
  const full = path.resolve(root, storagePath);
  if (!full.startsWith(root + path.sep)) throw new Error('storage path escapes STORAGE_DIR');
  return full;
}

/** Copies the temp upload into STORAGE_DIR while hashing it, then removes the temp file. */
export async function saveUpload(tmpPath: string, instrumentId: string, ext: string): Promise<StoredFile> {
  const storagePath = `${instrumentId}/${randomUUID()}.${ext}`;
  const dest = resolveStored(storagePath);
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  const hash = createHash('sha256');
  let size = 0;
  const tap = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      hash.update(chunk);
      size += chunk.length;
      cb(null, chunk);
    },
  });
  try {
    await pipeline(fs.createReadStream(tmpPath), tap, fs.createWriteStream(dest, { flags: 'wx' }));
  } catch (err) {
    await fs.promises.rm(dest, { force: true });
    throw err;
  } finally {
    await removeTemp(tmpPath);
  }
  return { storagePath, sha256: hash.digest('hex'), size };
}

export function openForRead(storagePath: string): Readable {
  return fs.createReadStream(resolveStored(storagePath));
}

/** Removes a stored file that never got a DB row (failed transaction). Recorded files are never removed. */
export async function discardUnrecorded(storagePath: string): Promise<void> {
  await fs.promises.rm(resolveStored(storagePath), { force: true });
}

export async function removeTemp(tmpPath: string): Promise<void> {
  await fs.promises.rm(tmpPath, { force: true });
}
