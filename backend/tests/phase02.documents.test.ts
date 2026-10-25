import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { closePool, getPool, one } from '../src/db/pool';
import {
  api, bearer, countEvents, createDraftViaApi, pdfBytes, PNG_BYTES, resetDb, setToday, uploadDoc, userFor, type SeededUser,
} from './helpers';

afterAll(async () => {
  await closePool();
});

let inst1: SeededUser;

beforeEach(async () => {
  await resetDb();
  await setToday('2026-10-25');
  inst1 = await userFor('inst1@demo.in');
});

const docUrl = (id: string, docId: string, kind = 'download') => `/api/v1/instruments/${id}/documents/${docId}/${kind}`;

describe('phase 02 — documents', () => {
  it('stores the file under STORAGE_DIR/<instrumentId>/<uuid>.<ext> with checksum, never the original name', async () => {
    const { id } = await createDraftViaApi(inst1);
    const bytes = pdfBytes('fixed');
    const res = await uploadDoc(inst1, id, 'FDR_COPY', bytes, '../../etc/My "FDR".pdf');
    expect(res.status).toBe(201);
    expect(res.body.duplicateOf).toBeNull();
    expect(res.body.document).toMatchObject({ docType: 'FDR_COPY', mimeType: 'application/pdf', sizeBytes: bytes.length, filename: 'My FDR.pdf' });
    expect(res.body.document.storagePath).toBeUndefined();

    const row = await one<{ storage_path: string; sha256: string }>(getPool(), 'SELECT storage_path, sha256 FROM documents WHERE id = $1', [res.body.document.id]);
    expect(row.storage_path).toMatch(new RegExp(`^${id}/[0-9a-f-]{36}\\.pdf$`));
    const onDisk = fs.readFileSync(path.join(config.storageDir, row.storage_path));
    expect(onDisk.equals(bytes)).toBe(true);
    expect(row.sha256).toBe((await import('node:crypto')).createHash('sha256').update(bytes).digest('hex'));
    expect(await countEvents("action = 'DOCUMENT_UPLOADED' AND instrument_id = $1", [id])).toBe(1);
  });

  it("AC4: institution 2 can't download institution 1's file (404); officer can; every download logs DOCUMENT_ACCESSED", async () => {
    const { id } = await createDraftViaApi(inst1);
    const bytes = pdfBytes();
    const up = await uploadDoc(inst1, id, 'FDR_COPY', bytes, 'fdr copy.pdf');
    const docId = up.body.document.id;

    const inst2 = await userFor('inst2@demo.in');
    expect((await api().get(docUrl(id, docId)).set(...bearer(inst2))).status).toBe(404);
    expect((await api().get(docUrl(id, docId, 'preview')).set(...bearer(inst2))).status).toBe(404);
    expect(await countEvents("action = 'DOCUMENT_ACCESSED'")).toBe(0);

    const officer = await userFor('officer@demo.in');
    const dl = await api().get(docUrl(id, docId)).set(...bearer(officer)).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(dl.status).toBe(200);
    expect(dl.headers['content-type']).toBe('application/pdf');
    expect(dl.headers['content-disposition']).toMatch(/^attachment; filename="fdr copy.pdf"/);
    expect((dl.body as Buffer).equals(bytes)).toBe(true);

    const pv = await api().get(docUrl(id, docId, 'preview')).set(...bearer(officer));
    expect(pv.status).toBe(200);
    expect(pv.headers['content-disposition']).toMatch(/^inline;/);

    expect((await api().get(docUrl(id, docId)).set(...bearer(inst1))).status).toBe(200);
    for (const email of ['approver@demo.in', 'admin@demo.in', 'auditor@demo.in']) {
      expect((await api().get(docUrl(id, docId)).set(...bearer(await userFor(email)))).status, email).toBe(200);
    }
    expect(await countEvents("action = 'DOCUMENT_ACCESSED' AND entity_id = $1", [docId])).toBe(6);
    expect((await api().get(docUrl(id, docId))).status).toBe(401);
  });

  it('AC5: a renamed non-PDF with .pdf extension is rejected (422)', async () => {
    const { id } = await createDraftViaApi(inst1);
    const res = await api()
      .post(`/api/v1/instruments/${id}/documents`)
      .set(...bearer(inst1))
      .field('docType', 'FDR_COPY')
      .attach('file', Buffer.from('MZ\x90\x00 this is really an executable or text'), { filename: 'fdr.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('UNSUPPORTED_FILE_TYPE');
    expect(await countEvents("action = 'DOCUMENT_UPLOADED'")).toBe(0);
    // PNG and JPEG are accepted by content.
    const png = await uploadDoc(inst1, id, 'BANK_LETTER', PNG_BYTES, 'letter.pdf');
    expect(png.status).toBe(201);
    expect(png.body.document.mimeType).toBe('image/png');
  });

  it('AC6: uploading the same bytes again returns duplicateOf', async () => {
    const { id } = await createDraftViaApi(inst1);
    const bytes = pdfBytes('same');
    const a = await uploadDoc(inst1, id, 'FDR_COPY', bytes);
    const b = await uploadDoc(inst1, id, 'BANK_LETTER', bytes);
    expect(b.status).toBe(201);
    expect(b.body.duplicateOf).toBe(a.body.document.id);
  });

  it('D15: delete is soft, hides the document, keeps the file, and is ignored by duplicate detection', async () => {
    const { id } = await createDraftViaApi(inst1);
    const bytes = pdfBytes('soft');
    const a = await uploadDoc(inst1, id, 'FDR_COPY', bytes);
    const docId = a.body.document.id;
    expect((await api().delete(`/api/v1/instruments/${id}/documents/${docId}`).set(...bearer(inst1))).status).toBe(204);

    const detail = await api().get(`/api/v1/instruments/${id}`).set(...bearer(inst1));
    expect(detail.body.documents).toEqual([]);
    expect(detail.body.missingDocs).toEqual(['FDR_COPY', 'BANK_LETTER']);
    const row = await one<{ deleted_at: Date | null; storage_path: string }>(getPool(), 'SELECT deleted_at, storage_path FROM documents WHERE id = $1', [docId]);
    expect(row.deleted_at).not.toBeNull();
    expect(fs.existsSync(path.join(config.storageDir, row.storage_path))).toBe(true);
    expect(await countEvents("action = 'DOCUMENT_REMOVED' AND entity_id = $1", [docId])).toBe(1);
    expect((await api().get(docUrl(id, docId)).set(...bearer(inst1))).status).toBe(404);

    const again = await uploadDoc(inst1, id, 'FDR_COPY', bytes);
    expect(again.body.duplicateOf).toBeNull();
  });

  it('upload validation: missing file / doc type listed together; too large → 422', async () => {
    const { id } = await createDraftViaApi(inst1);
    const res = await api().post(`/api/v1/instruments/${id}/documents`).set(...bearer(inst1)).field('docType', 'NOPE');
    expect(res.status).toBe(422);
    expect(res.body.details.map((d: { field: string }) => d.field).sort()).toEqual(['docType', 'file']);

    const big = Buffer.concat([pdfBytes(), Buffer.alloc(10 * 1024 * 1024)]);
    const tooBig = await uploadDoc(inst1, id, 'FDR_COPY', big);
    expect(tooBig.status).toBe(422);
    expect(tooBig.body.code).toBe('FILE_TOO_LARGE');
  });

  it("other institutions and AICTE roles can't upload", async () => {
    const { id } = await createDraftViaApi(inst1);
    expect((await uploadDoc(await userFor('inst2@demo.in'), id, 'FDR_COPY')).status).toBe(404);
    expect((await uploadDoc(await userFor('officer@demo.in'), id, 'FDR_COPY')).status).toBe(403);
  });
});
