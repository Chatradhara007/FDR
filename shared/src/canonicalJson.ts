// Deterministic JSON for hashing (D16): object keys sorted recursively, so JSONB key reordering
// never changes a hash. Follows JSON.stringify semantics for undefined/functions and toJSON().

function normalise(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  const withJson = value as { toJSON?: () => unknown };
  if (typeof withJson.toJSON === 'function') return normalise(withJson.toJSON());
  if (Array.isArray(value)) return value.map((v) => (v === undefined || typeof v === 'function' ? null : normalise(v)));
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const v = (value as Record<string, unknown>)[key];
    if (v === undefined || typeof v === 'function') continue;
    out[key] = normalise(v);
  }
  return out;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalise(value)) ?? 'null';
}
