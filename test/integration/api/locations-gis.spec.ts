'use strict';
import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { ServiceBroker } from 'moleculer';
import { ApiHelper, serviceBrokerConfig } from '../../helpers/api';

const broker = new ServiceBroker(serviceBrokerConfig);
const apiHelper = new ApiHelper(broker);
apiHelper.initializeServices();

beforeAll(async () => {
  await broker.start();
  await apiHelper.setup();
});
afterAll(() => broker.stop());
afterEach(() => jest.restoreAllMocks());

// Mock the GIS WMS responses for the river/lake + municipality lookups.
function mockFeatureFetchSequence(responses: any[]) {
  let i = 0;
  jest.spyOn(global, 'fetch').mockImplementation(() => {
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(r),
    }) as any;
  });
}

describe('location.service — INLAND_WATERS + getMunicipalityFromPoint', () => {
  it('search type=INLAND_WATERS returns the matched water body', async () => {
    mockFeatureFetchSequence([
      {
        features: [
          {
            properties: {
              '1. Pavadinimas': 'Test Lake',
              '2. Kadastro identifikavimo kodas': 'CAD-1',
            },
          },
        ],
      },
      // municipality lookup
      { features: [{ properties: { code: 41, name: 'Klaipėdos' } }] },
    ]);
    const res: any = await broker.call('locations.search', {
      query: { coordinates: { x: 21.13, y: 55.71 }, type: 'INLAND_WATERS' },
    });
    expect(res.name).toBe('Test Lake');
    expect(res.id).toBe('CAD-1');
    expect(res.type).toBe('INLAND_WATERS');
  });

  it('search type=INLAND_WATERS returns null when no features match', async () => {
    mockFeatureFetchSequence([{ features: [] }]);
    const res: any = await broker.call('locations.search', {
      query: { coordinates: { x: 21.13, y: 55.71 }, type: 'INLAND_WATERS' },
    });
    expect(res).toBeNull();
  });

  it('search type=ESTUARY throws when no bars match', async () => {
    mockFeatureFetchSequence([{ features: [] }]);
    await expect(
      broker.call('locations.search', {
        query: { coordinates: { x: 21.13, y: 55.71 }, type: 'ESTUARY' },
      }),
    ).rejects.toThrow(/Location not found/);
  });

  it('search type=ESTUARY returns matched bar', async () => {
    mockFeatureFetchSequence([
      // first fetch — bars
      {
        features: [{ properties: { id: 'BAR-1', name: 'Bar 1' } }],
      },
      // second fetch — municipality
      { features: [{ properties: { code: 41, name: 'Klaipėdos' } }] },
    ]);
    const res: any = await broker.call('locations.search', {
      query: { coordinates: { x: 21.13, y: 55.71 }, type: 'ESTUARY' },
    });
    expect(res.id).toBe('BAR-1');
    expect(res.type).toBe('ESTUARY');
  });

  it('getMunicipalityFromPoint returns null when GIS has no features', async () => {
    mockFeatureFetchSequence([{ features: [] }]);
    // Invoke via the polder search path which calls getMunicipalityFromPoint
    const res: any = await broker.call('locations.search', {
      query: { coordinates: { x: 21.13, y: 55.71 }, type: 'POLDERS' },
    });
    expect(res).toEqual(expect.objectContaining({ type: 'POLDERS' }));
    expect(res.municipality).toBeNull();
  });
});
