import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../src/canonicalJson';

describe('canonicalJson', () => {
  it('sorts keys recursively', () => {
    const a = { b: 1, a: { d: [{ z: 1, y: 2 }], c: 'x' } };
    const b = { a: { c: 'x', d: [{ y: 2, z: 1 }] }, b: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(canonicalJson(a)).toBe('{"a":{"c":"x","d":[{"y":2,"z":1}]},"b":1}');
  });
  it('follows JSON.stringify for undefined, null and dates', () => {
    expect(canonicalJson({ a: undefined, b: null })).toBe('{"b":null}');
    expect(canonicalJson([undefined])).toBe('[null]');
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson(undefined)).toBe('null');
    expect(canonicalJson({ t: new Date('2026-10-25T04:30:00.000Z') })).toBe('{"t":"2026-10-25T04:30:00.000Z"}');
  });
});
