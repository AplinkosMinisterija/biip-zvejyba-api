'use strict';
import { describe, expect, it } from '@jest/globals';
import ExcelJS from 'exceljs';
import {
  BoatCatchRow,
  CatchSummary,
  SUMMARY_MAX_MONTH_SHEETS,
  SUMMARY_UNASSIGNED_TOOL,
  ShoreCatchRow,
  allocateShoreCatch,
  buildCatchSummaryWorkbook,
  describeSummaryFilters,
  filterCatchEntries,
  selectLabels,
  splitProportionally,
  summarizeCatch,
  summaryMonths,
  toVilniusDate,
} from '../../modules/catchSummary';

const KARSIS = '1';
const STINTA = '2';
const KUOJA = '3';
const labelById = new Map([
  [KARSIS, 'Karšis'],
  [STINTA, 'Stinta'],
  [KUOJA, 'Kuoja'],
]);

const NETS = 'Statomieji tinklaičiai 45-50 mm';
const SMELT_TRAPS = 'Stintų gaudyklės 12, 12-16, 14-20';

const shore = (
  data: Record<string, number>,
  overrides: Partial<ShoreCatchRow> = {},
): ShoreCatchRow => ({
  fishing_id: 1,
  fishing_type: 'ESTUARY',
  tenant_id: 1,
  user_id: 1,
  tenant_name: 'UAB Pelona',
  first_name: null,
  last_name: null,
  month: '2025-02',
  data,
  ...overrides,
});

const boat = (
  toolType: string,
  locationId: string,
  data: Record<string, number>,
  fishingId = 1,
): BoatCatchRow => ({
  fishing_id: fishingId,
  tool_type: toolType,
  location_id: locationId,
  location_name: `${locationId} baras`,
  data,
});

const summarize = (shoreRows: ShoreCatchRow[], boatRows: BoatCatchRow[]) =>
  summarizeCatch(allocateShoreCatch(shoreRows, boatRows), { labelById, selectedLabels: null });

const build = (
  summary: CatchSummary,
  opts: Partial<Parameters<typeof buildCatchSummaryWorkbook>[1]>,
) =>
  buildCatchSummaryWorkbook(summary, {
    period: { from: null, to: null },
    months: [],
    types: [],
    filterLine: '',
    showToolTypes: false,
    ...opts,
  });

const cellValues = (sheet: ExcelJS.Worksheet, rowIndex: number) =>
  (sheet.getRow(rowIndex).values as unknown[]).slice(1);

const findRows = (sheet: ExcelJS.Worksheet, name: string) => {
  const rows: unknown[][] = [];
  sheet.eachRow((row, index) => {
    if (row.getCell(2).value === name) rows.push(cellValues(sheet, index));
  });
  return rows;
};

const titles = (sheet: ExcelJS.Worksheet) => {
  const found: unknown[] = [];
  sheet.eachRow((row) => found.push(row.getCell(1).value));
  return found;
};

// Column offsets in `cellValues`: Karšis = 2, Kuoja = 4, Stinta = 10, IŠ VISO = 20.
const TOTAL = 20;

describe('splitProportionally', () => {
  it('keeps the parts summing to the total in whole cents', () => {
    const parts = splitProportionally(10, [1, 1, 1]);
    expect(parts).toEqual([3.34, 3.33, 3.33]);
    expect(Math.round(parts.reduce((a, b) => a + b, 0) * 100)).toBe(1000);
  });

  it('splits by the boat weights', () => {
    expect(splitProportionally(12, [6, 2])).toEqual([9, 3]);
  });
});

describe('allocateShoreCatch', () => {
  it('splits the shore kg of a species over the boat weigh-ins that caught it', () => {
    const entries = allocateShoreCatch(
      [shore({ [KARSIS]: 12, [STINTA]: 4 })],
      [boat(NETS, '1', { [KARSIS]: 6 }), boat(SMELT_TRAPS, '2', { [KARSIS]: 2, [STINTA]: 5 })],
    );

    expect(
      entries.map(({ toolType, location, fishTypeId, kg }) => [
        toolType,
        location?.id,
        fishTypeId,
        kg,
      ]),
    ).toEqual([
      [NETS, '1', KARSIS, 9],
      [SMELT_TRAPS, '2', KARSIS, 3],
      [SMELT_TRAPS, '2', STINTA, 4],
    ]);
  });

  it('leaves a species nobody weighed on the boat without tool and bar', () => {
    const entries = allocateShoreCatch(
      [shore({ [KUOJA]: 1 })],
      [boat(NETS, '1', { [KARSIS]: 6 }), boat(NETS, '1', {})],
    );

    expect(entries).toEqual([expect.objectContaining({ toolType: null, location: null, kg: 1 })]);
  });

  it('never borrows boat weigh-ins from another fishing', () => {
    const entries = allocateShoreCatch(
      [shore({ [KARSIS]: 5 }, { fishing_id: 2 })],
      [boat(NETS, '1', { [KARSIS]: 6 }, 1)],
    );

    expect(entries[0].toolType).toBeNull();
  });
});

describe('filterCatchEntries', () => {
  const entries = allocateShoreCatch(
    [shore({ [KARSIS]: 12, [KUOJA]: 1 })],
    [boat(NETS, '1', { [KARSIS]: 6 }), boat(SMELT_TRAPS, '2', { [KARSIS]: 2 })],
  );

  it('keeps only the catch attributed to the picked bar', () => {
    const kept = filterCatchEntries(entries, {
      location: { id: '2', name: '2 baras' },
      toolTypes: null,
    });
    expect(kept.map((entry) => entry.kg)).toEqual([3]);
  });

  it('matches the bar on id AND name — polder and bar ids collide', () => {
    const kept = filterCatchEntries(entries, {
      location: { id: '2', name: 'Polderis 2' },
      toolTypes: null,
    });
    expect(kept).toEqual([]);
  });

  it('keeps only the picked tool types, never the unattributed kg', () => {
    const kept = filterCatchEntries(entries, { location: null, toolTypes: new Set([NETS]) });
    expect(kept.map((entry) => [entry.toolType, entry.kg])).toEqual([[NETS, 9]]);
  });
});

describe('summaryMonths', () => {
  it('lists every month of the period, empty ones too', () => {
    expect(summaryMonths({ from: '2024-11-15', to: '2025-02-10' }, ['2025-01'])).toEqual([
      '2024-11',
      '2024-12',
      '2025-01',
      '2025-02',
    ]);
  });

  it('falls back to the data for an open bound', () => {
    expect(summaryMonths({ from: null, to: null }, ['2025-03', '2025-01'])).toEqual([
      '2025-01',
      '2025-02',
      '2025-03',
    ]);
    expect(summaryMonths({ from: '2025-05-01', to: null }, [])).toEqual(['2025-05']);
    expect(summaryMonths({ from: null, to: null }, [])).toEqual([]);
  });

  it('stops just past the sheet cap instead of walking a mistyped century', () => {
    expect(summaryMonths({ from: '1900-01-01', to: '2025-01-01' }, [])).toHaveLength(
      SUMMARY_MAX_MONTH_SHEETS + 1,
    );
  });
});

describe('toVilniusDate', () => {
  it('reads an instant as the Vilnius calendar day', () => {
    // Vilnius midnight of 1 January is still 31 December in UTC.
    expect(toVilniusDate(new Date('2024-12-31T22:00:00.000Z'))).toBe('2025-01-01');
    expect(toVilniusDate(new Date('2025-05-31T20:59:59.999Z'))).toBe('2025-05-31');
    expect(toVilniusDate(new Date('2025-05-31'))).toBe('2025-05-31');
  });
});

describe('selectLabels', () => {
  it('means "no filter" when nothing is picked', () => {
    expect(selectLabels(labelById, undefined)).toBeNull();
    expect(selectLabels(labelById, [])).toBeNull();
  });

  it('fails closed on ids it does not know', () => {
    expect(selectLabels(labelById, ['999'])).toEqual(new Set());
    expect(selectLabels(labelById, [KARSIS, '999'])).toEqual(new Set(['Karšis']));
  });
});

describe('describeSummaryFilters', () => {
  it('names every filter, "visi"/"visos" for the unset ones', () => {
    expect(
      describeSummaryFilters({ types: [], location: null, toolTypes: null, fishTypes: null }),
    ).toBe('Vieta: visos · Kvadratas / polderis: visi · Įrankiai: visi · Rūšys: visos');
  });

  it('labels the second field after the single picked zone', () => {
    expect(
      describeSummaryFilters({
        types: ['ESTUARY'],
        location: { id: '12', name: '12' },
        toolTypes: new Set([NETS]),
        fishTypes: new Set(['Karšis', 'Stinta']),
      }),
    ).toBe(`Vieta: Kuršių marios · Kvadratas: 12 · Įrankiai: ${NETS} · Rūšys: Karšis, Stinta`);

    expect(
      describeSummaryFilters({
        types: ['POLDERS', 'ESTUARY'],
        location: null,
        toolTypes: null,
        fishTypes: null,
      }),
    ).toBe(
      'Vieta: Kuršių marios, polderiai · Kvadratas / polderis: visi · Įrankiai: visi · Rūšys: visos',
    );
  });
});

describe('buildCatchSummaryWorkbook', () => {
  const summary = summarize(
    [
      shore({ [KARSIS]: 12, [STINTA]: 4, [KUOJA]: 1 }),
      shore({ [KARSIS]: 5 }, { fishing_id: 2, fishing_type: 'POLDERS', month: '2025-03' }),
    ],
    [boat(NETS, '1', { [KARSIS]: 6 }), boat(SMELT_TRAPS, '2', { [KARSIS]: 2, [STINTA]: 5 })],
  );

  it('keeps two fishers apart even when they share a name', () => {
    const namesake: Partial<ShoreCatchRow> = {
      tenant_id: null,
      tenant_name: null,
      first_name: 'Jonas',
      last_name: 'Jonaitis',
    };
    const sheet = build(
      summarize(
        [
          shore({ [KARSIS]: 2 }, { ...namesake, fishing_id: 3, user_id: 7 }),
          shore({ [KARSIS]: 5 }, { ...namesake, fishing_id: 4, user_id: 8 }),
        ],
        [],
      ),
      {},
    ).getWorksheet('Suvestinė')!;

    expect(findRows(sheet, 'Jonas Jonaitis').map((row) => row[TOTAL])).toEqual([2, 5]);
  });

  it('shows only the picked zones', () => {
    const sheet = build(summary, { types: ['ESTUARY'] }).getWorksheet('Suvestinė')!;

    expect(titles(sheet)).toContain('KURŠIŲ MARIOSE:');
    expect(titles(sheet)).not.toContain('POLDERIUOSE:');
    expect(titles(sheet)).not.toContain('NEMUNO ŽEMUPYJE, ŠVENTOSIOS UPĖJE:');
    expect(findRows(sheet, 'IŠ VISO:')[0][TOTAL]).toBe(17);
  });

  it('shows all three zones when none is picked', () => {
    const sheet = build(summary, {}).getWorksheet('Suvestinė')!;

    expect(titles(sheet)).toEqual(
      expect.arrayContaining([
        'KURŠIŲ MARIOSE:',
        'NEMUNO ŽEMUPYJE, ŠVENTOSIOS UPĖJE:',
        'POLDERIUOSE:',
      ]),
    );
    expect(findRows(sheet, 'IŠ VISO:')[0][TOTAL]).toBe(22);
  });

  it('writes the filter line under the period', () => {
    const sheet = build(summary, {
      period: { from: '2025-01-01', to: '2025-05-31' },
      filterLine: 'Vieta: Kuršių marios · Kvadratas: visi · Įrankiai: visi · Rūšys: visos',
    }).getWorksheet('Suvestinė')!;

    expect(sheet.getCell(2, 1).value).toBe('UŽ 2025-01-01 – 2025-05-31');
    expect(sheet.getCell(3, 1).value).toBe(
      'Vieta: Kuršių marios · Kvadratas: visi · Įrankiai: visi · Rūšys: visos',
    );
  });

  it('lists the tool rows under the company, summing to it', () => {
    const sheet = build(summary, { types: ['ESTUARY'], showToolTypes: true }).getWorksheet(
      'Suvestinė',
    )!;

    const company = findRows(sheet, 'UAB Pelona')[0];
    const nets = findRows(sheet, NETS)[0];
    const traps = findRows(sheet, SMELT_TRAPS)[0];
    const unassigned = findRows(sheet, SUMMARY_UNASSIGNED_TOOL)[0];

    expect([nets[2], nets[TOTAL]]).toEqual([9, 9]);
    expect([traps[2], traps[10], traps[TOTAL]]).toEqual([3, 4, 7]);
    expect([unassigned[4], unassigned[TOTAL]]).toEqual([1, 1]);
    expect(company[TOTAL]).toBe(17);
  });

  it('adds a sheet per month, named by month number within one year', () => {
    const workbook = build(summary, { months: ['2025-02', '2025-03'] });

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['Suvestinė', '02', '03']);
    expect(workbook.getWorksheet('02')!.getCell(2, 1).value).toBe('UŽ 2025 M. VASARIO MĖN.');
    expect(findRows(workbook.getWorksheet('02')!, 'IŠ VISO:')[0][TOTAL]).toBe(17);
    expect(findRows(workbook.getWorksheet('03')!, 'IŠ VISO:')[0][TOTAL]).toBe(5);
  });

  it('names month sheets with the year when the period crosses one', () => {
    const workbook = build(summary, {
      months: ['2024-12', '2025-01'],
      period: { from: '2024-12-10', to: '2025-01-31' },
    });

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      'Suvestinė',
      '2024-12',
      '2025-01',
    ]);
    // A clipped month says which days it covers.
    expect(workbook.getWorksheet('2024-12')!.getCell(2, 1).value).toBe(
      'UŽ 2024 M. GRUODŽIO MĖN. (2024-12-10 – 2024-12-31)',
    );
    expect(workbook.getWorksheet('2025-01')!.getCell(2, 1).value).toBe('UŽ 2025 M. SAUSIO MĖN.');
  });
});

// Dev named species `karpiai`/`ešeriai`, prod `Karpis`/`Ešerys`, and the whole
// summary once silently turned into „Kitos žuvys“.
describe('registry spelling', () => {
  const buildWith = (labels: Map<string, string>, data: Record<string, number>) =>
    build(
      summarizeCatch(allocateShoreCatch([shore(data, { tenant_name: 'Rašybos UAB' })], []), {
        labelById: labels,
        selectedLabels: null,
      }),
      {},
    );

  it('matches regardless of letter case and spacing', () => {
    const workbook = buildWith(new Map([['1', '  KARPIS ']]), { '1': 5 });

    const row = findRows(workbook.getWorksheet('Suvestinė')!, 'Rašybos UAB')[0];
    expect(row[18]).toBe(5); // Karpis, not „Kitos žuvys“
    expect(row[19]).toBe(0);
    expect(workbook.getWorksheet('Nepriskirtos rūšys')).toBeUndefined();
  });

  it('counts an unmapped species in „Kitos“ AND lists it on its own sheet', () => {
    const workbook = buildWith(new Map([['1', 'karpiai']]), { '1': 7 });

    const row = findRows(workbook.getWorksheet('Suvestinė')!, 'Rašybos UAB')[0];
    expect(row[18]).toBe(0); // not in the Karpis column
    expect(row[19]).toBe(7); // but the total is intact
    expect(row[20]).toBe(7);

    const diagnostics = workbook.getWorksheet('Nepriskirtos rūšys')!;
    expect(cellValues(diagnostics, 4)).toEqual(['karpiai', 7]);
  });

  it('lists a deleted species by its id', () => {
    const workbook = buildWith(new Map(), { '999': 3 });
    expect(cellValues(workbook.getWorksheet('Nepriskirtos rūšys')!, 4)).toEqual(['ID 999', 3]);
  });
});
