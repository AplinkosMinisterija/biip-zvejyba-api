'use strict';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import ExcelJS from 'exceljs';
import { ServiceBroker } from 'moleculer';
import request from 'supertest';
import { ApiHelper, serviceBrokerConfig } from '../../helpers/api';
import { MockAuthState } from '../../helpers/mock-auth.service';

// One ESTUARY trip that fished two bars with two tool types, weighed on the
// boat per tool and once on shore. The shore weigh-in carries neither gear nor
// bar, so the summary has to spread it over the boat weigh-ins.
const broker = new ServiceBroker(serviceBrokerConfig);
const apiHelper = new ApiHelper(broker);
const apiService = apiHelper.initializeServices();

const url = '/zvejyba/api/researches/catchSummary';
const coords = { x: 21.13, y: 55.71 };
const bar = (id: string) => ({
  id,
  name: `${id} baras`,
  type: 'ESTUARY',
  municipality: { id: 41, name: 'Klaipėda' },
});

const NETS = 'Statomieji tinklaičiai 45-50 mm';
const SMELT_TRAPS = 'Stintų gaudyklės 12, 12-16, 14-20';

// Offsets in `cellValues`: Karšis = 2, Kuoja = 4, Stinta = 10, IŠ VISO = 20.
const KARSIS = 2;
const KUOJA = 4;
const STINTA = 10;
const TOTAL = 20;

let investigator: any;
let toolTypeIdByLabel: Map<string, any>;
let fishingId: number;
let ownerMeta: any;
let fish: Map<string, any>;

const loadWorkbook = async (buffer: any) => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook;
};

const summary = async (params: Record<string, unknown>) =>
  loadWorkbook(
    await broker.call('researches.catchSummary', params, { meta: apiHelper.meta(investigator) }),
  );

const cellValues = (sheet: ExcelJS.Worksheet, rowIndex: number) =>
  (sheet.getRow(rowIndex).values as any[]).slice(1);

const findRow = (sheet: ExcelJS.Worksheet, name: string) => {
  let found: any[] | null = null;
  sheet.eachRow((row, index) => {
    if (!found && row.getCell(2).value === name) found = cellValues(sheet, index);
  });
  return found as any[] | null;
};

const titles = (sheet: ExcelJS.Worksheet) => {
  const found: unknown[] = [];
  sheet.eachRow((row) => found.push(row.getCell(1).value));
  return found;
};

const setShoreDate = (date: string) =>
  (broker.getLocalService('weightEvents') as any).rawQuery(
    null,
    `UPDATE weight_events SET date = ? WHERE fishing_id = ? AND tools_group_id IS NULL`,
    [date, fishingId],
  );

beforeAll(async () => {
  await broker.start();
  await apiHelper.setup();

  investigator = await apiHelper.makeAuthUser();
  MockAuthState.setPermissions(investigator.authUser.id, {
    FISHING: { accesses: ['INVESTIGATOR'] },
  });

  const meta = apiHelper.meta(apiHelper.ownerA, apiHelper.tenantA.tenant.id);
  ownerMeta = meta;
  const headers = apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id);

  const toolTypes: any[] = await broker.call('toolTypes.find');
  toolTypeIdByLabel = new Map(toolTypes.map((toolType) => [toolType.label, toolType.id]));
  const fishTypes: any[] = await broker.call('fishTypes.find');
  fish = new Map(fishTypes.map((fishType) => [fishType.label, fishType.id]));

  for (const [sealNr, label] of [
    ['S-SPLIT-1', NETS],
    ['S-SPLIT-2', SMELT_TRAPS],
  ]) {
    await broker.call(
      'tools.create',
      { sealNr, toolType: toolTypeIdByLabel.get(label), data: { eyeSize: 60, netLength: 30 } },
      { meta },
    );
  }

  const fishing: any = await broker.call(
    'fishings.startFishing',
    { type: 'ESTUARY', coordinates: coords },
    { meta },
  );
  fishingId = fishing.id;

  const groups: any[] = await broker.call(
    'toolsGroups.find',
    { query: { removeEvent: { $exists: false } }, populate: ['tools'] },
    { meta },
  );
  const groupOf = (label: string) =>
    groups.find((group) => group.tools[0].toolType.label === label).id;

  const buildAndWeigh = async (label: string, location: any, data: Record<string, number>) => {
    const id = groupOf(label);
    await request(apiService.server)
      .post(`/zvejyba/api/toolsGroups/build/${id}`)
      .set(headers)
      .send({ coordinates: coords, location })
      .expect(200);
    await request(apiService.server)
      .post(`/zvejyba/api/toolsGroups/weigh/${id}`)
      .set(headers)
      .send({ coordinates: coords, location, data })
      .expect(200);
  };

  // Karšis weighed 6 + 2 on the boat → shore 12 splits 9 / 3.
  await buildAndWeigh(NETS, bar('1'), { [fish.get('Karšis')]: 6 });
  await buildAndWeigh(SMELT_TRAPS, bar('2'), {
    [fish.get('Karšis')]: 2,
    [fish.get('Stinta')]: 5,
  });

  // Kuoja never went through a boat weigh-in, so it has no tool and no bar.
  await broker.call(
    'weightEvents.createWeightEvent',
    {
      coordinates: coords,
      data: { [fish.get('Karšis')]: 12, [fish.get('Stinta')]: 4, [fish.get('Kuoja')]: 1 },
    },
    { meta },
  );
});
afterAll(() => broker.stop());

describe('researches.catchSummary — tool types', () => {
  it('lists the company tool rows with the shore kg split by the boat weigh-ins', async () => {
    const sheet = (await summary({ byToolTypes: true })).getWorksheet('Suvestinė')!;

    const company = findRow(sheet, 'Company-A')!;
    const nets = findRow(sheet, NETS)!;
    const traps = findRow(sheet, SMELT_TRAPS)!;
    const unassigned = findRow(sheet, 'Įrankis nenurodytas')!;

    expect([company[KARSIS], company[STINTA], company[KUOJA], company[TOTAL]]).toEqual([
      12, 4, 1, 17,
    ]);
    expect([nets[KARSIS], nets[TOTAL]]).toEqual([9, 9]);
    expect([traps[KARSIS], traps[STINTA], traps[TOTAL]]).toEqual([3, 4, 7]);
    expect([unassigned[KUOJA], unassigned[TOTAL]]).toEqual([1, 1]);
  });

  it('keeps one row per company when the toggle is off', async () => {
    const sheet = (await summary({})).getWorksheet('Suvestinė')!;

    expect(findRow(sheet, 'Company-A')![TOTAL]).toBe(17);
    expect(findRow(sheet, NETS)).toBeNull();
    expect(findRow(sheet, 'Įrankis nenurodytas')).toBeNull();
  });
});

describe('researches.catchSummary — bar filter', () => {
  it('counts only the fish caught at the picked bar of a multi-bar trip', async () => {
    const sheet = (
      await summary({ types: ['ESTUARY'], locationId: '1', locationName: '1 baras' })
    ).getWorksheet('Suvestinė')!;

    const company = findRow(sheet, 'Company-A')!;
    expect([company[KARSIS], company[STINTA], company[TOTAL]]).toEqual([9, 0, 9]);
    expect(sheet.getCell(3, 1).value).toBe(
      'Vieta: Kuršių marios · Kvadratas: 1 baras · Rūšys: visos',
    );
  });

  it('shows "visi" when no bar is picked', async () => {
    const sheet = (await summary({ types: ['ESTUARY'] })).getWorksheet('Suvestinė')!;

    expect(findRow(sheet, 'Company-A')![TOTAL]).toBe(17);
    expect(sheet.getCell(3, 1).value).toBe('Vieta: Kuršių marios · Kvadratas: visi · Rūšys: visos');
  });
});

describe('researches.catchSummary — zones', () => {
  it('draws only the picked zones', async () => {
    const sheet = (await summary({ types: ['ESTUARY'] })).getWorksheet('Suvestinė')!;

    expect(titles(sheet)).toContain('KURŠIŲ MARIOSE:');
    expect(titles(sheet)).not.toContain('POLDERIUOSE:');
    expect(titles(sheet)).not.toContain('NEMUNO ŽEMUPYJE, ŠVENTOSIOS UPĖJE:');
    expect(findRow(sheet, 'Iš viso polderiuose:')).toBeNull();
    expect(findRow(sheet, 'IŠ VISO:')![TOTAL]).toBe(17);
  });

  it('accepts the zones as a query-string list over HTTP', async () => {
    const res = await request(apiService.server)
      .get(`${url}?types=ESTUARY&types=POLDERS&byMonths=true&byToolTypes=true`)
      .set(apiHelper.getHeaders(investigator.token))
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);

    const sheet = (await loadWorkbook(res.body)).getWorksheet('Suvestinė')!;
    expect(titles(sheet)).toEqual(expect.arrayContaining(['KURŠIŲ MARIOSE:', 'POLDERIUOSE:']));
    expect(titles(sheet)).not.toContain('NEMUNO ŽEMUPYJE, ŠVENTOSIOS UPĖJE:');
  });

  it('still rejects a plain fisher', async () => {
    const res = await request(apiService.server)
      .get(`${url}?byMonths=true`)
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id));
    expect([401, 403]).toContain(res.status);
  });
});

describe('researches.catchSummary — months', () => {
  beforeAll(() => setShoreDate('2025-01-20T10:00:00Z'));

  it('adds a sheet per month of the period, summing to the whole-period sheet', async () => {
    const workbook = await summary({
      dateFrom: '2024-12-01',
      dateTo: '2025-02-28',
      byMonths: true,
    });

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      'Suvestinė',
      '2024-12',
      '2025-01',
      '2025-02',
    ]);

    const monthTotals = ['2024-12', '2025-01', '2025-02'].map(
      (name) => findRow(workbook.getWorksheet(name)!, 'IŠ VISO:')![TOTAL],
    );
    expect(monthTotals).toEqual([0, 17, 0]);
    expect(findRow(workbook.getWorksheet('Suvestinė')!, 'IŠ VISO:')![TOTAL]).toBe(17);
    expect(workbook.getWorksheet('2025-01')!.getCell(2, 1).value).toBe('UŽ 2025 M. SAUSIO MĖN.');
  });

  it('files a weigh-in by its Vilnius day, not its UTC one', async () => {
    // 22:30 UTC on 31 January is already 1 February in Vilnius.
    await setShoreDate('2025-01-31T22:30:00Z');

    const workbook = await summary({
      dateFrom: '2025-01-01',
      dateTo: '2025-02-28',
      byMonths: true,
    });

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['Suvestinė', '01', '02']);
    expect(findRow(workbook.getWorksheet('01')!, 'IŠ VISO:')![TOTAL]).toBe(0);
    expect(findRow(workbook.getWorksheet('02')!, 'IŠ VISO:')![TOTAL]).toBe(17);
  });

  it('rejects a period too long to split by months', async () => {
    await expect(
      summary({ dateFrom: '1900-01-01', dateTo: '2025-01-01', byMonths: true }),
    ).rejects.toThrow(/months/);
  });
});

// Runs after the months block: the shore row is dated 2025-02-01 (Vilnius) by now.
describe('researches.catchSummary — corrections', () => {
  it('counts only the latest shore weigh-in, on the day of the first', async () => {
    // Re-submitting the shore form inserts a second row; the first one stays.
    await broker.call(
      'weightEvents.createWeightEvent',
      {
        coordinates: coords,
        data: { [fish.get('Karšis')]: 14, [fish.get('Stinta')]: 4, [fish.get('Kuoja')]: 1 },
      },
      { meta: ownerMeta },
    );

    const february = (await summary({ dateFrom: '2025-02-01', dateTo: '2025-02-28' })).getWorksheet(
      'Suvestinė',
    )!;
    expect(findRow(february, 'Company-A')![TOTAL]).toBe(19);

    const allTime = (await summary({})).getWorksheet('Suvestinė')!;
    expect(findRow(allTime, 'Company-A')![TOTAL]).toBe(19);
  });

  it('keeps a deleted company under its own name', async () => {
    await broker.call(
      'tenants.remove',
      { id: apiHelper.tenantA.tenant.id },
      { meta: apiHelper.meta(apiHelper.adminA) },
    );

    const sheet = (await summary({})).getWorksheet('Suvestinė')!;
    expect(findRow(sheet, 'Company-A')![TOTAL]).toBe(19);
  });
});
