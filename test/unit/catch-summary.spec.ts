'use strict';
import { describe, expect, it } from '@jest/globals';
import ExcelJS from 'exceljs';
import {
  BoatCatchRow,
  CatchSummary,
  SUMMARY_MAX_MONTH_SHEETS,
  SUMMARY_UNASSIGNED_TOOL,
  ShoreCatchRow,
  SummaryFishType,
  allocateShoreCatch,
  buildCatchSummaryWorkbook,
  describeSummaryFilters,
  filterByLocation,
  splitProportionally,
  summarizeCatch,
  summaryFishColumns,
  summaryMonths,
  toVilniusDate,
} from '../../modules/catchSummary';

const KARSIS = '1';
const STINTA = '2';
const KUOJA = '3';
const fishTypes: SummaryFishType[] = [
  { id: KARSIS, label: 'Karšis', deleted: false },
  { id: STINTA, label: 'Stinta', deleted: false },
  { id: KUOJA, label: 'Kuoja', deleted: false },
];

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
  summarizeCatch(allocateShoreCatch(shoreRows, boatRows), null);

const build = (
  summary: CatchSummary,
  opts: Partial<Parameters<typeof buildCatchSummaryWorkbook>[1]>,
) =>
  buildCatchSummaryWorkbook(summary, {
    period: { from: null, to: null },
    months: [],
    types: [],
    fishColumns: summaryFishColumns(fishTypes, null, summary.fishTypeIds),
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

const HEADER_ROW = 4;

// kg in the column headed `header`, on the `nth` row named `rowName`.
const kg = (sheet: ExcelJS.Worksheet, rowName: string, header: string, nth = 0) =>
  findRows(sheet, rowName)[nth][cellValues(sheet, HEADER_ROW).indexOf(header)];

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

describe('filterByLocation', () => {
  const entries = allocateShoreCatch(
    [shore({ [KARSIS]: 12, [KUOJA]: 1 })],
    [boat(NETS, '1', { [KARSIS]: 6 }), boat(SMELT_TRAPS, '2', { [KARSIS]: 2 })],
  );

  it('keeps only the catch attributed to the picked bar', () => {
    const kept = filterByLocation(entries, { id: '2', name: '2 baras' });
    expect(kept.map((entry) => entry.kg)).toEqual([3]);
  });

  it('matches the bar on id AND name — polder and bar ids collide', () => {
    expect(filterByLocation(entries, { id: '2', name: 'Polderis 2' })).toEqual([]);
  });

  it('keeps everything when no bar is picked', () => {
    expect(filterByLocation(entries, null)).toBe(entries);
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

describe('describeSummaryFilters', () => {
  it('names every filter, "visi"/"visos" for the unset ones', () => {
    expect(describeSummaryFilters({ types: [], location: null, fishTypes: null })).toBe(
      'Vieta: visos · Kvadratas / polderis: visi · Rūšys: visos',
    );
  });

  it('labels the second field after the single picked zone', () => {
    expect(
      describeSummaryFilters({
        types: ['ESTUARY'],
        location: { id: '12', name: '12' },
        fishTypes: ['Karšis', 'Stinta'],
      }),
    ).toBe('Vieta: Kuršių marios · Kvadratas: 12 · Rūšys: Karšis, Stinta');

    expect(
      describeSummaryFilters({
        types: ['POLDERS', 'ESTUARY'],
        location: null,
        fishTypes: null,
      }),
    ).toBe('Vieta: Kuršių marios, polderiai · Kvadratas / polderis: visi · Rūšys: visos');
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

  it('heads the columns with the registry species, then IŠ VISO', () => {
    const sheet = build(summary, {}).getWorksheet('Suvestinė')!;

    expect(cellValues(sheet, HEADER_ROW)).toEqual([
      'Eil. Nr.',
      'ĮMONĖS (ORGANIZACIJOS) PAVADINIMAS',
      'Karšis',
      'Stinta',
      'Kuoja',
      'IŠ VISO',
    ]);
    expect(findRows(sheet, 'UAB Pelona')[0].slice(2)).toEqual([12, 4, 1, 17]);
  });

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

    expect([0, 1].map((nth) => kg(sheet, 'Jonas Jonaitis', 'IŠ VISO', nth))).toEqual([2, 5]);
  });

  it('shows only the picked zones', () => {
    const sheet = build(summary, { types: ['ESTUARY'] }).getWorksheet('Suvestinė')!;

    expect(titles(sheet)).toContain('KURŠIŲ MARIOSE:');
    expect(titles(sheet)).not.toContain('POLDERIUOSE:');
    expect(titles(sheet)).not.toContain('NEMUNO ŽEMUPYJE, ŠVENTOSIOS UPĖJE:');
    expect(kg(sheet, 'IŠ VISO:', 'IŠ VISO')).toBe(17);
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
    expect(kg(sheet, 'IŠ VISO:', 'IŠ VISO')).toBe(22);
  });

  it('writes the filter line under the period', () => {
    const sheet = build(summary, {
      period: { from: '2025-01-01', to: '2025-05-31' },
      filterLine: 'Vieta: Kuršių marios · Kvadratas: visi · Rūšys: visos',
    }).getWorksheet('Suvestinė')!;

    expect(sheet.getCell(2, 1).value).toBe('UŽ 2025-01-01 – 2025-05-31');
    expect(sheet.getCell(3, 1).value).toBe('Vieta: Kuršių marios · Kvadratas: visi · Rūšys: visos');
  });

  it('lists the tool rows under the company, summing to it', () => {
    const sheet = build(summary, { types: ['ESTUARY'], showToolTypes: true }).getWorksheet(
      'Suvestinė',
    )!;

    const at = (row: string) => (header: string) => kg(sheet, row, header);

    expect(['Karšis', 'IŠ VISO'].map(at(NETS))).toEqual([9, 9]);
    expect(['Karšis', 'Stinta', 'IŠ VISO'].map(at(SMELT_TRAPS))).toEqual([3, 4, 7]);
    expect(['Kuoja', 'IŠ VISO'].map(at(SUMMARY_UNASSIGNED_TOOL))).toEqual([1, 1]);
    expect(kg(sheet, 'UAB Pelona', 'IŠ VISO')).toBe(17);
  });

  it('adds a sheet per month, always named with the year', () => {
    const workbook = build(summary, { months: ['2025-02', '2025-03'] });

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      'Suvestinė',
      '2025-02',
      '2025-03',
    ]);
    expect(workbook.getWorksheet('2025-02')!.getCell(2, 1).value).toBe('UŽ 2025 M. VASARIO MĖN.');
    expect(kg(workbook.getWorksheet('2025-02')!, 'IŠ VISO:', 'IŠ VISO')).toBe(17);
    expect(kg(workbook.getWorksheet('2025-03')!, 'IŠ VISO:', 'IŠ VISO')).toBe(5);
  });

  it('says which days a clipped month covers', () => {
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

describe('summaryFishColumns', () => {
  const registry: SummaryFishType[] = [
    ...fishTypes,
    { id: '4', label: 'Seliava', deleted: true },
    { id: '5', label: 'Vėžys', deleted: true },
  ];
  const labels = (columns: { label: string }[]) => columns.map((column) => column.label);

  it('lists every active species in registry order when nothing is picked', () => {
    expect(labels(summaryFishColumns(registry, null, new Set([STINTA])))).toEqual([
      'Karšis',
      'Stinta',
      'Kuoja',
    ]);
  });

  it('keeps a deleted species only while old weigh-ins still carry its kg', () => {
    expect(labels(summaryFishColumns(registry, null, new Set(['4'])))).toEqual([
      'Karšis',
      'Stinta',
      'Kuoja',
      'Seliava',
    ]);
  });

  it('heads a species missing from the registry by its id', () => {
    expect(labels(summaryFishColumns(registry, null, new Set(['999'])))).toContain('ID 999');
  });

  it('shows only the picked species, in the order picked', () => {
    expect(labels(summaryFishColumns(registry, new Set([STINTA, KARSIS]), new Set()))).toEqual([
      'Stinta',
      'Karšis',
    ]);
  });
});

describe('species filter', () => {
  it('shows only the picked species, then IŠ VISO', () => {
    const picked = new Set([STINTA, KARSIS]);
    const summary = summarizeCatch(
      allocateShoreCatch([shore({ [KARSIS]: 12, [STINTA]: 4, [KUOJA]: 1 })], []),
      picked,
    );
    const sheet = build(summary, {
      fishColumns: summaryFishColumns(fishTypes, picked, summary.fishTypeIds),
    }).getWorksheet('Suvestinė')!;

    expect(cellValues(sheet, HEADER_ROW).slice(2)).toEqual(['Stinta', 'Karšis', 'IŠ VISO']);
    expect(findRows(sheet, 'UAB Pelona')[0]).toEqual([1, 'UAB Pelona', 4, 12, 16]);
  });
});
