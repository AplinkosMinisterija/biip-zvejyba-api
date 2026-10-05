import ExcelJS from 'exceljs';
import { LocationType } from '../types';

type SummaryZone = {
  type: LocationType;
  title: string;
  totalLabel: string;
  filterLabel: string;
};

// INLAND_WATERS replaces the reference's smelt / river-lamprey migration
// blocks: the migration period is not modelled.
const SUMMARY_ZONES: SummaryZone[] = [
  {
    type: LocationType.ESTUARY,
    title: 'KURŠIŲ MARIOSE:',
    totalLabel: 'IŠ VISO (Kuršių mariose):',
    filterLabel: 'Kuršių marios',
  },
  {
    type: LocationType.INLAND_WATERS,
    title: 'NEMUNO ŽEMUPYJE, ŠVENTOSIOS UPĖJE:',
    totalLabel: 'Iš viso Nemuno žemupyje, Šventosios upėje:',
    filterLabel: 'Nemuno žemupys, Šventoji',
  },
  {
    type: LocationType.POLDERS,
    title: 'POLDERIUOSE:',
    totalLabel: 'Iš viso polderiuose:',
    filterLabel: 'polderiai',
  },
];

const SINGLE_ZONE_LOCATION_LABEL: Record<string, string> = {
  [LocationType.ESTUARY]: 'Kvadratas',
  [LocationType.POLDERS]: 'Polderis',
};

const SUMMARY_TITLE =
  'ŽVEJYBOS VERSLINĖS ŽVEJYBOS ĮRANKIAIS KURŠIŲ MARIOSE, NEMUNO ŽEMUPYJE, ' +
  'ŠVENTOJOJE (PAJŪRIO) UPĖSE ATASKAITŲ SUVESTINĖ (KG.)';

const MONTH_GENITIVE = [
  'SAUSIO',
  'VASARIO',
  'KOVO',
  'BALANDŽIO',
  'GEGUŽĖS',
  'BIRŽELIO',
  'LIEPOS',
  'RUGPJŪČIO',
  'RUGSĖJO',
  'SPALIO',
  'LAPKRIČIO',
  'GRUODŽIO',
];

const VILNIUS_DATE = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Vilnius',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export const toVilniusDate = (date: Date) => {
  const parts = VILNIUS_DATE.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
};

export const SUMMARY_UNASSIGNED_TOOL = 'Įrankis nenurodytas';

// Ten years of month sheets; anything longer is a mistyped period, not a report.
export const SUMMARY_MAX_MONTH_SHEETS = 120;

const SUMMARY_HEADER_ROW = 4;

// fish type id → kg
type SummaryTotals = Map<string, number>;

type PartySummary = {
  name: string;
  totals: SummaryTotals;
  byTool: Map<string, SummaryTotals>;
};

type SheetSummary = Map<string, Map<string, PartySummary>>;

export type CatchSummary = {
  all: SheetSummary;
  byMonth: Map<string, SheetSummary>;
  fishTypeIds: Set<string>;
};

export type SummaryFishType = { id: string; label: string; deleted: boolean };

export type SummaryFishColumn = { id: string; label: string };

// Calendar dates (`YYYY-MM-DD`) in Europe/Vilnius.
export type SummaryPeriod = { from: string | null; to: string | null };

type FishWeights = Record<string, number> | null;

export type ShoreCatchRow = {
  fishing_id: number;
  fishing_type: string;
  tenant_id: number | null;
  user_id: number | null;
  tenant_name: string | null;
  first_name: string | null;
  last_name: string | null;
  month: string;
  data: FishWeights;
};

export type BoatCatchRow = {
  fishing_id: number;
  tool_type_id: string | null;
  tool_type: string | null;
  location_id: string | null;
  location_name: string | null;
  data: FishWeights;
};

export type CatchLocation = { id: string; name: string };

export type CatchEntry = {
  fishingType: string;
  partyKey: string;
  partyName: string;
  month: string;
  toolTypeId: string | null;
  toolType: string | null;
  location: CatchLocation | null;
  fishTypeId: string;
  kg: number;
};

const emptyTotals = (): SummaryTotals => new Map();

const addKg = (kgByKey: Map<string, number>, key: string, kg: number) =>
  kgByKey.set(key, (kgByKey.get(key) || 0) + kg);

const addTotals = (target: SummaryTotals, source: SummaryTotals) =>
  source.forEach((kg, fishTypeId) => addKg(target, fishTypeId, kg));

const round2 = (value: number) => Math.round(value * 100) / 100;

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

const getOrCreate = <K, V>(map: Map<K, V>, key: K, create: () => V): V => {
  const existing = map.get(key);
  if (existing !== undefined) return existing;

  const created = create();
  map.set(key, created);
  return created;
};

const kgOf = (data: FishWeights, fishTypeId: string) => {
  const kg = Number(data?.[fishTypeId]);
  return Number.isFinite(kg) ? kg : 0;
};

const partyName = (row: ShoreCatchRow) =>
  row.tenant_name || `${row.first_name || ''} ${row.last_name || ''}`.trim() || 'Nenurodyta';

// Keyed by id: two fishers can share a name.
const partyKey = (row: ShoreCatchRow) =>
  row.tenant_id ? `tenant:${row.tenant_id}` : `user:${row.user_id}`;

// Splits in whole cents (largest remainder), so the parts always add back up to
// the total — otherwise a company row could differ from its tool rows by 0.01.
export const splitProportionally = (total: number, weights: number[]): number[] => {
  const cents = Math.round(total * 100);
  const weightSum = sum(weights);
  const exact = weights.map((weight) => (cents * weight) / weightSum);
  const parts = exact.map(Math.floor);

  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - parts[index] }))
    .sort((a, b) => b.remainder - a.remainder);
  for (let i = 0; i < cents - sum(parts); i++) {
    parts[byRemainder[i].index] += 1;
  }

  return parts.map((part) => part / 100);
};

// The shore weigh-in is the official figure but carries neither gear nor bar;
// the boat weigh-ins carry both. Each species' shore kg is split over the boat
// weigh-ins of the same fishing in proportion to what they recorded.
export const allocateShoreCatch = (
  shoreRows: ShoreCatchRow[],
  boatRows: BoatCatchRow[],
): CatchEntry[] => {
  const boatByFishing = new Map<number, BoatCatchRow[]>();
  boatRows.forEach((row) => getOrCreate(boatByFishing, Number(row.fishing_id), () => []).push(row));

  return shoreRows.flatMap((row) => {
    const base = {
      fishingType: row.fishing_type,
      partyKey: partyKey(row),
      partyName: partyName(row),
      month: row.month,
    };
    const boat = boatByFishing.get(Number(row.fishing_id)) || [];

    return Object.keys(row.data || {}).flatMap((fishTypeId): CatchEntry[] => {
      const kg = kgOf(row.data, fishTypeId);
      if (kg === 0) return [];

      const weighed = boat.filter((boatRow) => kgOf(boatRow.data, fishTypeId) > 0);
      if (kg < 0 || !weighed.length) {
        return [{ ...base, fishTypeId, kg, toolTypeId: null, toolType: null, location: null }];
      }

      const parts = splitProportionally(
        kg,
        weighed.map((boatRow) => kgOf(boatRow.data, fishTypeId)),
      );

      return weighed.map((boatRow, index) => ({
        ...base,
        fishTypeId,
        kg: parts[index],
        toolTypeId: boatRow.tool_type_id,
        toolType: boatRow.tool_type,
        location:
          boatRow.location_id && boatRow.location_name
            ? { id: boatRow.location_id, name: boatRow.location_name }
            : null,
      }));
    });
  });
};

// Polder and bar ids collide, so a location matches on id AND name.
export const filterByLocation = (entries: CatchEntry[], location: CatchLocation | null) =>
  location
    ? entries.filter(
        (entry) => entry.location?.id === location.id && entry.location?.name === location.name,
      )
    : entries;

// Kg never weighed on the boat has no tool, so a tool filter leaves it out.
export const filterByToolTypes = (entries: CatchEntry[], toolTypeIds: Set<string> | null) =>
  toolTypeIds
    ? entries.filter((entry) => !!entry.toolTypeId && toolTypeIds.has(entry.toolTypeId))
    : entries;

const addToSheet = (sheet: SheetSummary, entry: CatchEntry) => {
  const parties = getOrCreate(sheet, entry.fishingType, () => new Map<string, PartySummary>());
  const party = getOrCreate(parties, entry.partyKey, () => ({
    name: entry.partyName,
    totals: emptyTotals(),
    byTool: new Map<string, SummaryTotals>(),
  }));
  const tool = getOrCreate(party.byTool, entry.toolType || SUMMARY_UNASSIGNED_TOOL, emptyTotals);

  addKg(party.totals, entry.fishTypeId, entry.kg);
  addKg(tool, entry.fishTypeId, entry.kg);
};

export const summarizeCatch = (
  entries: CatchEntry[],
  selectedFishTypes: Set<string> | null,
): CatchSummary => {
  const summary: CatchSummary = { all: new Map(), byMonth: new Map(), fishTypeIds: new Set() };

  for (const entry of entries) {
    if (selectedFishTypes && !selectedFishTypes.has(entry.fishTypeId)) continue;

    summary.fishTypeIds.add(entry.fishTypeId);
    addToSheet(summary.all, entry);
    addToSheet(
      getOrCreate(summary.byMonth, entry.month, () => new Map()),
      entry,
    );
  }

  return summary;
};

// No filter: every species in the registry, plus a deleted one that still has
// kg in old weigh-ins, so no catch drops out of the totals.
export const summaryFishColumns = (
  fishTypes: SummaryFishType[],
  selectedFishTypes: Set<string> | null,
  fishTypeIdsWithCatch: Set<string>,
): SummaryFishColumn[] => {
  const labelById = new Map(fishTypes.map((fishType) => [fishType.id, fishType.label]));
  const column = (id: string) => ({ id, label: labelById.get(id) ?? `ID ${id}` });

  if (selectedFishTypes) return Array.from(selectedFishTypes, column);

  const listed = fishTypes.filter(
    (fishType) => !fishType.deleted || fishTypeIdsWithCatch.has(fishType.id),
  );
  const unknown = Array.from(fishTypeIdsWithCatch).filter((id) => !labelById.has(id));

  return [...listed.map(({ id }) => column(id)), ...unknown.sort().map(column)];
};

const nextMonth = (month: string) => {
  const [year, monthNumber] = month.split('-').map(Number);
  return monthNumber === 12
    ? `${year + 1}-01`
    : `${year}-${String(monthNumber + 1).padStart(2, '0')}`;
};

export const summaryMonths = (period: SummaryPeriod, dataMonths: string[]): string[] => {
  const sorted = [...dataMonths].sort();
  const first: string | undefined = period.from?.slice(0, 7) ?? sorted[0];
  const last: string | undefined = period.to?.slice(0, 7) ?? sorted[sorted.length - 1];
  const start = first ?? last;
  const end = last ?? first;
  if (!start || !end) return [];

  const months: string[] = [];
  // Stops one past the cap so the caller can reject the period without this
  // loop walking centuries first.
  for (let month = start; month <= end; month = nextMonth(month)) {
    months.push(month);
    if (months.length > SUMMARY_MAX_MONTH_SHEETS) break;
  }
  return months;
};

const lastDayOfMonth = (month: string) => {
  const [year, monthNumber] = month.split('-').map(Number);
  return `${month}-${new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()}`;
};

const formatMonthTitle = (month: string, period: SummaryPeriod) => {
  const [year, monthNumber] = month.split('-').map(Number);
  const title = `${year} M. ${MONTH_GENITIVE[monthNumber - 1]} MĖN.`;

  const firstDay = `${month}-01`;
  const lastDay = lastDayOfMonth(month);
  const from = period.from && period.from > firstDay ? period.from : null;
  const to = period.to && period.to < lastDay ? period.to : null;

  if (!from && !to) return title;
  return `${title} (${from ?? firstDay} – ${to ?? lastDay})`;
};

const formatSummaryPeriod = ({ from, to }: SummaryPeriod) => {
  if (from && to) return `${from} – ${to}`;
  if (from) return `LAIKOTARPĮ NUO ${from}`;
  if (to) return `LAIKOTARPĮ IKI ${to}`;
  return 'VISĄ LAIKOTARPĮ';
};

const selectedZones = (types: string[]) =>
  types.length ? SUMMARY_ZONES.filter((zone) => types.includes(zone.type)) : SUMMARY_ZONES;

const listOrAll = (labels: Iterable<string> | null, all: string) => {
  const list = Array.from(labels || []);
  return list.length ? list.join(', ') : all;
};

export const describeSummaryFilters = (filter: {
  types: string[];
  location: CatchLocation | null;
  toolTypes: string[] | null;
  fishTypes: string[] | null;
}) => {
  const locationLabel =
    (filter.types.length === 1 && SINGLE_ZONE_LOCATION_LABEL[filter.types[0]]) ||
    'Kvadratas / polderis';
  const zones = filter.types.length
    ? selectedZones(filter.types).map((zone) => zone.filterLabel)
    : null;

  return [
    `Vieta: ${listOrAll(zones, 'visos')}`,
    `${locationLabel}: ${filter.location?.name || 'visi'}`,
    `Įrankiai: ${listOrAll(filter.toolTypes, 'visi')}`,
    `Rūšys: ${listOrAll(filter.fishTypes, 'visos')}`,
  ].join(' · ');
};

type SheetColumn = { header: string; value: (totals: SummaryTotals) => number };

const totalKg = (totals: SummaryTotals) => sum(Array.from(totals.values()));

const sheetColumns = (fishColumns: SummaryFishColumn[]): SheetColumn[] => [
  ...fishColumns.map(({ id, label }) => ({
    header: label,
    value: (totals: SummaryTotals) => totals.get(id) || 0,
  })),
  { header: 'IŠ VISO', value: totalKg },
];

const rowValues = (
  columns: SheetColumn[],
  first: string | number,
  name: string,
  totals: SummaryTotals,
) => [first, name, ...columns.map((column) => round2(column.value(totals)))];

type SheetLayout = {
  periodLine: string;
  filterLine: string;
  zones: SummaryZone[];
  showToolTypes: boolean;
  columns: SheetColumn[];
};

const renderSheetHeader = (sheet: ExcelJS.Worksheet, layout: SheetLayout) => {
  const { columns } = layout;

  sheet.views = [{ state: 'frozen', xSplit: 2, ySplit: SUMMARY_HEADER_ROW }];

  sheet.getCell(1, 1).value = SUMMARY_TITLE;
  sheet.getCell(1, 1).font = { bold: true };
  sheet.getCell(2, 1).value = layout.periodLine;
  sheet.getCell(3, 1).value = layout.filterLine;

  const headerRow = sheet.getRow(SUMMARY_HEADER_ROW);
  headerRow.values = [
    'Eil. Nr.',
    layout.showToolTypes
      ? 'ĮMONĖS (ORGANIZACIJOS) PAVADINIMAS / ĮRANKIO TIPAS'
      : 'ĮMONĖS (ORGANIZACIJOS) PAVADINIMAS',
    ...columns.map((column) => column.header),
  ];
  headerRow.font = { bold: true };
  headerRow.alignment = { wrapText: true, vertical: 'bottom' };

  sheet.getColumn(1).width = 8;
  sheet.getColumn(2).width = layout.showToolTypes ? 46 : 38;
  columns.forEach((_column, index) => {
    sheet.getColumn(3 + index).width = 12;
  });
};

const sortedToolRows = (byTool: Map<string, SummaryTotals>) =>
  Array.from(byTool.entries()).sort(([a], [b]) => {
    if (a === SUMMARY_UNASSIGNED_TOOL) return 1;
    if (b === SUMMARY_UNASSIGNED_TOOL) return -1;
    return a.localeCompare(b, 'lt');
  });

// Returns the next free row index.
const renderToolRows = (
  sheet: ExcelJS.Worksheet,
  startRow: number,
  byTool: Map<string, SummaryTotals>,
  columns: SheetColumn[],
) => {
  let rowIndex = startRow;
  for (const [toolType, totals] of sortedToolRows(byTool)) {
    const row = sheet.getRow(rowIndex++);
    row.values = rowValues(columns, '', toolType, totals);
    row.getCell(2).alignment = { indent: 1 };
    if (toolType === SUMMARY_UNASSIGNED_TOOL) row.getCell(2).font = { italic: true };
  }
  return rowIndex;
};

const renderSummarySheet = (sheet: ExcelJS.Worksheet, data: SheetSummary, layout: SheetLayout) => {
  renderSheetHeader(sheet, layout);

  const { columns } = layout;
  let rowIndex = SUMMARY_HEADER_ROW + 1;
  const grandTotals = emptyTotals();

  for (const zone of layout.zones) {
    const parties = Array.from(data.get(zone.type)?.values() || []).sort((a, b) =>
      a.name.localeCompare(b.name, 'lt'),
    );

    const titleRow = sheet.getRow(rowIndex++);
    titleRow.getCell(1).value = zone.title;
    titleRow.font = { bold: true };

    const zoneTotals = emptyTotals();

    parties.forEach((summary, index) => {
      const partyRow = sheet.getRow(rowIndex++);
      partyRow.values = rowValues(columns, index + 1, summary.name, summary.totals);

      if (layout.showToolTypes) {
        partyRow.font = { bold: true };
        rowIndex = renderToolRows(sheet, rowIndex, summary.byTool, columns);
      }

      addTotals(zoneTotals, summary.totals);
    });

    const totalRow = sheet.getRow(rowIndex++);
    totalRow.values = rowValues(columns, '', zone.totalLabel, zoneTotals);
    totalRow.font = { bold: true };

    addTotals(grandTotals, zoneTotals);
    rowIndex++;
  }

  const grandRow = sheet.getRow(rowIndex);
  grandRow.values = rowValues(columns, '', 'IŠ VISO:', grandTotals);
  grandRow.font = { bold: true };
};

export const buildCatchSummaryWorkbook = (
  summary: CatchSummary,
  opts: {
    period: SummaryPeriod;
    months: string[];
    types: string[];
    fishColumns: SummaryFishColumn[];
    filterLine: string;
    showToolTypes: boolean;
  },
) => {
  const workbook = new ExcelJS.Workbook();
  const layout = {
    filterLine: opts.filterLine,
    zones: selectedZones(opts.types),
    showToolTypes: opts.showToolTypes,
    columns: sheetColumns(opts.fishColumns),
  };

  renderSummarySheet(workbook.addWorksheet('Suvestinė'), summary.all, {
    ...layout,
    periodLine: `UŽ ${formatSummaryPeriod(opts.period)}`,
  });

  for (const month of opts.months) {
    renderSummarySheet(workbook.addWorksheet(month), summary.byMonth.get(month) || new Map(), {
      ...layout,
      periodLine: `UŽ ${formatMonthTitle(month, opts.period)}`,
    });
  }

  return workbook;
};
