'use strict';
import { describe, expect, it } from '@jest/globals';
import {
  getExtention,
  getMimetype,
  getPublicFileName,
  IMAGE_TYPES,
  FILE_TYPES,
} from '../../../types';
import { getFolderName, isInGroup } from '../../../utils';

// Pure functions in types/uploads.ts and utils — no broker needed.

describe('uploads helpers', () => {
  it('getExtention maps known mimetypes', () => {
    expect(getExtention('image/png')).toBe('png');
    expect(getExtention('image/jpeg')).toBe('jpeg');
    expect(getExtention('application/pdf')).toBe('pdf');
  });

  it('getMimetype derives type from filename', () => {
    expect(getMimetype('foo.png')).toBe('image/png');
    expect(getMimetype('bar.pdf')).toBe('application/pdf');
  });

  it('getPublicFileName is a random hex of the requested length', () => {
    const n = getPublicFileName(20);
    expect(typeof n).toBe('string');
    expect(n.length).toBe(20);
  });

  it('IMAGE_TYPES and FILE_TYPES contain expected entries', () => {
    expect(IMAGE_TYPES).toEqual(expect.arrayContaining(['image/png', 'image/jpeg']));
    expect(FILE_TYPES).toEqual(expect.arrayContaining(['application/pdf']));
  });
});

describe('utils', () => {
  it('getFolderName builds a tenant-aware path when profile is set', () => {
    const folder = getFolderName({ id: 5 } as any, { id: 3 } as any);
    expect(typeof folder).toBe('string');
    expect(folder.length).toBeGreaterThan(0);
  });

  it('getFolderName falls back to user-only path without profile', () => {
    const folder = getFolderName({ id: 5 } as any, undefined as any);
    expect(typeof folder).toBe('string');
  });

  it('isInGroup is true when the group id is present', () => {
    const groups = [{ id: 1 }, { id: 2 }];
    expect(isInGroup(groups, '1')).toBe(true);
    expect(isInGroup(groups, '99')).toBe(false);
  });
});
