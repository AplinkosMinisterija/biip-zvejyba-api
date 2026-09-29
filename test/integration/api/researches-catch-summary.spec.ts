'use strict';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import ExcelJS from 'exceljs';
import { ServiceBroker } from 'moleculer';
import request from 'supertest';
import { ApiHelper, serviceBrokerConfig } from '../../helpers/api';
import { MockAuthState } from '../../helpers/mock-auth.service';

const broker = new ServiceBroker(serviceBrokerConfig);
const apiHelper = new ApiHelper(broker);
const apiService = apiHelper.initializeServices();

const url = '/zvejyba/api/researches/catchSummary';
const coords = { x: 21.13, y: 55.71 };

let investigator: any;
let fishTypeIdByLabel: Map<string, any>;

// One fishing per tenant and zone, so block separation is exercised too.
async function seedShoreCatch(owner: any, tenantId: any, type: string, data: any) {
  const meta = apiHelper.meta(owner, tenantId);
  const toolTypes: any[] = await broker.call('toolTypes.find');
  await broker.call(
    'tools.create',
    {
      sealNr: `S-SUM-${Math.floor(Math.random() * 1_000_000)}`,
      toolType: toolTypes[0].id,
      data: { eyeSize: 60, netLength: 30 },
    },
    { meta },
  );
  await broker.call('fishings.startFishing', { type, coordinates: coords }, { meta });
  await broker.call('weightEvents.createWeightEvent', { coordinates: coords, data }, { meta });
}

const loadSheet = async (buffer: any) => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook.getWorksheet('Suvestinė')!;
};

const cellValues = (sheet: any, rowIndex: number) =>
  (sheet.getRow(rowIndex).values as any[]).slice(1);

const findRow = (sheet: any, name: string) => {
  let found: any[] | null = null;
  sheet.eachRow((row: any, index: number) => {
    if (found) return;
    if (row.getCell(2).value === name) found = cellValues(sheet, index);
  });
  return found;
};

// kg in the column headed `header` on the row named `rowName`.
const kg = (sheet: any, rowName: string, header: string) =>
  findRow(sheet, rowName)![cellValues(sheet, 4).indexOf(header)];

beforeAll(async () => {
  await broker.start();
  await apiHelper.setup();

  investigator = await apiHelper.makeAuthUser();
  MockAuthState.setPermissions(investigator.authUser.id, {
    FISHING: { accesses: ['INVESTIGATOR'] },
  });

  const fishTypes: any[] = await broker.call('fishTypes.find');
  fishTypeIdByLabel = new Map(fishTypes.map((fish) => [fish.label, fish.id]));

  // Karšis → main column, Perpelė → „Kitos žuvys“ breakdown, Seliava → neither,
  // so it must land in the breakdown's „Kitos“.
  await seedShoreCatch(apiHelper.ownerA, apiHelper.tenantA.tenant.id, 'ESTUARY', {
    [fishTypeIdByLabel.get('Karšis')]: 10,
    [fishTypeIdByLabel.get('Perpelė')]: 4,
    [fishTypeIdByLabel.get('Seliava')]: 6,
  });
  await seedShoreCatch(apiHelper.ownerB, apiHelper.tenantB.tenant.id, 'POLDERS', {
    [fishTypeIdByLabel.get('Karšis')]: 5,
  });
});
afterAll(() => broker.stop());

describe('researches.catchSummary — auth', () => {
  it('rejects a plain USER without the INVESTIGATOR access', async () => {
    const res = await request(apiService.server)
      .get(url)
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id));
    expect([401, 403]).toContain(res.status);
  });

  it('rejects an anonymous caller', async () => {
    const res = await request(apiService.server).get(url);
    expect([401, 403]).toContain(res.status);
  });

  // `mappingPolicy: 'all'` also publishes the action on the fallback URL
  // (CLAUDE.md „Action exposure“).
  it('applies the same gate on the mappingPolicy fallback URL', async () => {
    const res = await request(apiService.server)
      .post('/zvejyba/api/researches/catchSummary')
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id));
    expect([401, 403]).toContain(res.status);
  });

  it('lets an INVESTIGATOR download the xlsx', async () => {
    const res = await request(apiService.server)
      .get(url)
      .set(apiHelper.getHeaders(investigator.token))
      .expect(200);

    expect(res.headers['content-disposition']).toContain('versliniai_sugavimai_suvestine.xlsx');
  });

  // Admin accounts carry no INVESTIGATOR access (api.service `authorize`).
  it('lets an ADMIN download the xlsx too', async () => {
    await request(apiService.server)
      .get(url)
      .set(apiHelper.getHeaders(apiHelper.adminA.token))
      .expect(200);
  });
});

describe('researches.catchSummary — sheet', () => {
  it('heads the columns with every registry species, then IŠ VISO', async () => {
    const buffer = await broker.call(
      'researches.catchSummary',
      {},
      { meta: apiHelper.meta(investigator) },
    );
    const header = cellValues(await loadSheet(buffer), 4);

    // Same order as the app's weighing form: by priority, then name.
    const registry: any[] = await broker.call('fishTypes.find', { fields: ['label', 'priority'] });
    const expected = registry
      .sort(
        (a, b) =>
          Number(b.priority || 0) - Number(a.priority || 0) || a.label.localeCompare(b.label, 'lt'),
      )
      .map((fishType) => fishType.label);

    expect(header).toEqual([
      'Eil. Nr.',
      'ĮMONĖS (ORGANIZACIJOS) PAVADINIMAS',
      ...expected,
      'IŠ VISO',
    ]);
  });

  it('sums a tenant into the right zone, every species in its own column', async () => {
    const buffer = await broker.call(
      'researches.catchSummary',
      {},
      { meta: apiHelper.meta(investigator) },
    );
    const sheet = await loadSheet(buffer);

    expect(cellValues(sheet, 5)[0]).toBe('KURŠIŲ MARIOSE:');
    expect(
      ['Karšis', 'Perpelė', 'Seliava', 'IŠ VISO'].map((header) => kg(sheet, 'Company-A', header)),
    ).toEqual([10, 4, 6, 20]);
  });

  it('keeps each zone in its own block and totals them all', async () => {
    const buffer = await broker.call(
      'researches.catchSummary',
      {},
      { meta: apiHelper.meta(investigator) },
    );
    const sheet = await loadSheet(buffer);

    expect(kg(sheet, 'IŠ VISO (Kuršių mariose):', 'IŠ VISO')).toBe(20);
    expect(kg(sheet, 'Iš viso polderiuose:', 'IŠ VISO')).toBe(5);
    // Company-B fished in polders, so it must stay out of the lagoon block.
    expect(kg(sheet, 'Iš viso Nemuno žemupyje, Šventosios upėje:', 'IŠ VISO')).toBe(0);
    expect(kg(sheet, 'IŠ VISO:', 'IŠ VISO')).toBe(25);
  });

  it('narrows the totals when a fish-type filter is applied', async () => {
    const buffer = await broker.call(
      'researches.catchSummary',
      { fishTypes: [String(fishTypeIdByLabel.get('Karšis'))] },
      { meta: apiHelper.meta(investigator) },
    );
    const sheet = await loadSheet(buffer);

    expect(cellValues(sheet, 4)).toEqual([
      'Eil. Nr.',
      'ĮMONĖS (ORGANIZACIJOS) PAVADINIMAS',
      'Karšis',
      'IŠ VISO',
    ]);
    expect(findRow(sheet, 'Company-A')).toEqual([1, 'Company-A', 10, 10]);
  });

  it('narrows the totals when a fishing-type filter is applied', async () => {
    const buffer = await broker.call(
      'researches.catchSummary',
      { types: ['POLDERS'] },
      { meta: apiHelper.meta(investigator) },
    );
    const sheet = await loadSheet(buffer);

    expect(findRow(sheet, 'Company-A')).toBeNull();
    expect(kg(sheet, 'IŠ VISO:', 'IŠ VISO')).toBe(5);
  });

  it('excludes catches outside the requested period', async () => {
    const buffer = await broker.call(
      'researches.catchSummary',
      { dateFrom: '2000-01-01', dateTo: '2000-12-31' },
      { meta: apiHelper.meta(investigator) },
    );

    expect(kg(await loadSheet(buffer), 'IŠ VISO:', 'IŠ VISO')).toBe(0);
  });

  it('rejects an unparseable date', async () => {
    await expect(
      broker.call(
        'researches.catchSummary',
        { dateFrom: 'ne-data' },
        { meta: apiHelper.meta(investigator) },
      ),
    ).rejects.toThrow(/dateFrom/);
  });
});
