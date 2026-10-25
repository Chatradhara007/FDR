import {
  STATUS_LABELS, TRACKED_FIELDS, sameTrackedValue, submissionIssues, trackedValue, type InstrumentDetail, type VerificationState,
} from '@fdr/shared';
import { withTransaction } from '../db/pool';
import { actorOf, assertCanSee, type AuthUser } from '../domain/access';
import { recordEvent } from '../domain/audit';
import * as clock from '../domain/clock';
import { InvalidTransition, ValidationFailed } from '../domain/errors';
import { transition } from '../domain/stateMachine';
import { listLiveDocuments } from '../repositories/documentRepo';
import { lockInstrument, setSubmissionMeta } from '../repositories/instrumentRepo';
import { listProvenance, upsertProvenance } from '../repositories/provenanceRepo';
import { assertNoDuplicateRef, docRules, getInstrument, isEditable, missingDocs } from './instrumentService';

/** POST /instruments/:id/submit (2.5): DRAFT/RETURNED → SUBMITTED with D5 provenance. */
export async function submitInstrument(user: AuthUser, id: string): Promise<InstrumentDetail> {
  await withTransaction(async (tx) => {
    const inst = await lockInstrument(tx, id);
    assertCanSee(user, inst);
    if (!isEditable(inst.status)) throw new InvalidTransition(inst.status, 'SUBMITTED', `This instrument is ${STATUS_LABELS[inst.status]} and cannot be submitted again`);

    const now = await clock.now(tx);
    const today = clock.istDate(now);
    const rules = await docRules(tx);
    const fields = submissionIssues(inst, today);
    const missing = missingDocs(rules.requiredDocs[inst.type], (await listLiveDocuments(tx, id)).map((d) => d.docType));
    if (fields.length || missing.length) {
      throw new ValidationFailed({ fields, missingDocuments: missing }, 'The submission is incomplete');
    }
    await assertNoDuplicateRef(tx, inst);

    // D5: only fields whose value changed go back to CLAIMED; unchanged fields keep their tier.
    const existing = new Map((await listProvenance(tx, id)).map((p) => [p.fieldName, p]));
    let changed = false;
    const submitted: Record<string, string> = {};
    for (const field of TRACKED_FIELDS) {
      const value = trackedValue(field, inst);
      submitted[field] = value;
      const prev = existing.get(field);
      if (prev && sameTrackedValue(field, prev.value, value)) continue;
      changed = true;
      await upsertProvenance(tx, id, { fieldName: field, value, tier: 'CLAIMED', source: 'institution' }, now);
    }
    const firstSubmission = inst.submittedAt === null;
    const verificationState: VerificationState = firstSubmission || changed ? 'UNVERIFIED' : inst.verificationState;
    await setSubmissionMeta(tx, id, { submittedAt: now, verificationState });
    await transition(tx, { id, status: inst.status }, 'SUBMITTED', actorOf(user));
    await recordEvent(tx, {
      actor: actorOf(user), action: 'INSTRUMENT_SUBMITTED', entityType: 'instrument', entityId: id, instrumentId: id,
      after: { ...submitted, branch: inst.branch, purpose: inst.purpose, verificationState, resubmission: !firstSubmission },
    });
  });
  return getInstrument(user, id);
}
