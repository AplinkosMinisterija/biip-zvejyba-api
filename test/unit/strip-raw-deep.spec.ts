'use strict';
import { describe, expect, it } from '@jest/globals';
import { stripRawDeep } from '../../utils';

// `stripRawDeep` is the single source of truth behind both scope sanitizers
// (profile.mixin `sanitizeUserQuery`, users.service `sanitizeQueryForTenantScope`).
// It must remove every `$raw` key at any depth — `$raw` reaches the knex
// adapter's `whereRaw` raw-SQL sink — while leaving all other operators and
// values intact.

describe('stripRawDeep', () => {
  it('removes a top-level $raw (string form)', () => {
    expect(stripRawDeep({ $raw: '1=1' })).toEqual({});
  });

  it('removes a top-level $raw (object/condition form)', () => {
    expect(stripRawDeep({ $raw: { condition: 'DROP TABLE x', bindings: [] } })).toEqual({});
  });

  it('removes $raw nested under a field operator', () => {
    expect(stripRawDeep({ id: { $gte: 0, $raw: 'evil' } })).toEqual({ id: { $gte: 0 } });
  });

  it('removes $raw nested inside an $or array', () => {
    const out = stripRawDeep({ $or: [{ id: { $raw: 'a' } }, { name: 'x' }] });
    expect(out).toEqual({ $or: [{ id: {} }, { name: 'x' }] });
  });

  it('removes $raw at multiple depths simultaneously', () => {
    const out = stripRawDeep({
      $raw: 'top',
      $and: [{ a: { $raw: 'deep' } }, { b: { c: { $raw: 'deeper' } } }],
    });
    expect(out).toEqual({ $and: [{ a: {} }, { b: { c: {} } }] });
  });

  it('preserves legitimate operators and scalar values', () => {
    const query = {
      type: 'INLAND_WATERS',
      id: { $in: [1, 2, 3] },
      $or: [{ tenant: 5 }, { deletedAt: { $exists: false } }],
    };
    expect(stripRawDeep(query)).toEqual(query);
  });

  it('passes scalars, null and undefined through untouched', () => {
    expect(stripRawDeep('hello')).toBe('hello');
    expect(stripRawDeep(42)).toBe(42);
    expect(stripRawDeep(null)).toBeNull();
    expect(stripRawDeep(undefined)).toBeUndefined();
  });

  it('only strips the literal key "$raw", not lookalikes', () => {
    const query = { $rawish: 'kept', raw: 'kept', nested: { $raw_: 'kept' } };
    expect(stripRawDeep(query)).toEqual(query);
  });
});
