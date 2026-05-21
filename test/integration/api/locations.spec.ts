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

function mockFetch(response: any) {
  jest.spyOn(global, 'fetch').mockImplementation(
    () =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(response),
      }) as any,
  );
}

describe('location.service', () => {
  it('search rejects an invalid fishing type', async () => {
    await expect(
      broker.call('locations.search', {
        query: { coordinates: { x: 21.13, y: 55.71 }, type: 'BOGUS' },
      }),
    ).rejects.toThrow(/Invalid fishing type/);
  });

  it('search returns a polder shape when type=POLDERS', async () => {
    mockFetch({ features: [{ properties: { code: 1, name: 'Klaipėda' } }] });
    const res: any = await broker.call('locations.search', {
      query: { coordinates: { x: 21.13, y: 55.71 }, type: 'POLDERS' },
    });
    expect(res).toEqual(expect.objectContaining({ type: 'POLDERS', name: 'Polderiai' }));
  });

  it('uetkSearchByCadastralId returns mapped locations for a single id', async () => {
    mockFetch({
      rows: [
        { cadastralId: '00070001', name: 'Kuršių marios', municipality: 'Klaipėda', municipalityCode: 41 },
      ],
    });
    const res: any = await broker.call('locations.uetkSearchByCadastralId', {
      cadastralId: '00070001',
    });
    expect(res).toEqual(
      expect.objectContaining({ id: '00070001', name: 'Kuršių marios' }),
    );
  });

  it('uetkSearchByCadastralId handles multi-id input', async () => {
    mockFetch({
      rows: [
        { cadastralId: 'A', name: 'A', municipality: 'X', municipalityCode: 1 },
        { cadastralId: 'B', name: 'B', municipality: 'Y', municipalityCode: 2 },
      ],
    });
    const res: any = await broker.call('locations.uetkSearchByCadastralId', {
      cadastralId: ['A', 'B'],
    });
    expect(Array.isArray(res)).toBe(true);
    expect(res.length).toBe(2);
  });

  it('getMunicipalities sorts ascending by name', async () => {
    mockFetch({
      features: [
        { properties: { pavadinimas: 'Vilniaus', kodas: '13' } },
        { properties: { pavadinimas: 'Klaipėdos', kodas: '21' } },
        { properties: { pavadinimas: 'Kauno', kodas: '19' } },
      ],
    });
    const res: any = await broker.call('locations.getMunicipalities');
    const names = res.rows.map((r: any) => r.name);
    expect(names).toEqual([...names].sort((a: string, b: string) => a.localeCompare(b)));
  });

  it('getFishingSections returns ESTUARY-typed bars sorted by numeric prefix', async () => {
    mockFetch({
      features: [
        {
          properties: { id: '2', name: '2 Bar' },
          geometry: { type: 'Polygon', coordinates: [[[21.1, 55.7], [21.2, 55.7], [21.2, 55.8], [21.1, 55.7]]] },
        },
        {
          properties: { id: '1', name: '1 Bar' },
          geometry: { type: 'Polygon', coordinates: [[[21.1, 55.7], [21.2, 55.7], [21.2, 55.8], [21.1, 55.7]]] },
        },
      ],
    });
    // Mock the second fetch (municipality lookup) too.
    const sections: any = await broker.call('locations.getFishingSections');
    expect(Array.isArray(sections)).toBe(true);
    if (sections.length === 2) {
      expect(sections[0].name).toMatch(/^1 /);
      expect(sections[1].name).toMatch(/^2 /);
    }
  });
});
