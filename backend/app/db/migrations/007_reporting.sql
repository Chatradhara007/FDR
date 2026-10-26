-- Phase 07: dashboard, my day, reports, improvement metrics. Read-only phase: rules and one index.
CREATE INDEX alerts_instrument_status ON alerts (instrument_id, status);

-- Default rules (same values as shared/constants.json -> ruleDefaults).
INSERT INTO rules (key, name, type, config) VALUES
  ('risk_weights', 'My day risk weights', 'risk_weights',
   '{"amount":0.30,"urgency":0.30,"verification":0.20,"discrepancy":0.15,"escalation":0.05,"amountCap":"10000000.00","urgencyHorizonDays":90}'),
  ('improvement_baseline', 'Improvement baseline (manual process)', 'improvement_baseline',
   '{"manualStepsPerCase":14,"portalStepsPerCase":5,"manualVerificationDays":21,"manualLapseDetectionDays":45,"manualCaughtBeforeExpiryPct":40,"note":"Assumed manual process: spreadsheets, letters to banks, email reminders. Illustrative figures."}')
ON CONFLICT (key) DO NOTHING;
