import ExcelJS from 'exceljs';
import { LocationType } from '../types';

// Fixed to the AAD reference sheet, not generated from `fish_types`: a new
// species would shift the columns and break comparison with historical files.
type SummaryColumn = { header: string; labels: string[] };

const SUMMARY_MAIN_COLUMNS: SummaryColumn[] = [
  { header: 'Karšis', labels: ['Karšis'] },
  // The reference sheet has no column for undersized pikeperch.
  { header: 'Starkis', labels: ['Sterkas', 'Sterkas (neverslinio dydžio)'] },
  { header: 'Kuoja', labels: ['Kuoja'] },
  { header: 'Lydeka', labels: ['Lydeka'] },
  { header: 'Ešerys', labels: ['Ešerys'] },
  { header: 'Ungurys', labels: ['Ungurys'] },
  { header: 'Karosas', labels: ['Karosas', 'Karosas, auksinis', 'Karosas, sidabrinis'] },
  { header: 'Vėgėlė', labels: ['Vėgėlė'] },
  { header: 'Stinta', labels: ['Stinta'] },
  { header: 'Lynas', labels: ['Lynas'] },
  { header: 'Nėgė', labels: ['Nėgė'] },
  { header: 'Žiobris', labels: ['Žiobris'] },
  { header: 'Plakis', labels: ['Plakis'] },
  { header: 'Salatis', labels: ['Salatis'] },
  { header: 'Šamas', labels: ['Šamas'] },
  { header: 'Ožka', labels: ['Ožka'] },
  { header: 'Karpis', labels: ['Karpis'] },
];

// A species in neither list lands in the trailing „Kitos“ column.
const SUMMARY_OTHER_COLUMNS: SummaryColumn[] = [
  { header: 'Perpelė', labels: ['Perpelė'] },
  { header: 'Plačiakaktis', labels: ['Plačiakaktis'] },
  { header: 'Plekšnė', labels: ['Plekšnė'] },
  { header: 'Šapalas', labels: ['Šapalas'] },
  { header: 'Sykas', labels: ['Sykas'] },
  { header: 'Pūgžlys', labels: ['Pūgžlys'] },
  { header: 'Dyglė', labels: ['Dyglė'] },
  { header: 'Meknė', labels: ['Meknė'] },
  { header: 'Raudė', labels: ['Raudė'] },
  { header: 'Strimelė', labels: ['Strimelė'] },
  { header: 'Aukšlė', labels: ['Aukšlė'] },
  { header: 'Šlakis', labels: ['Šlakis'] },
  { header: 'Lašiša', labels: ['Lašiša'] },
];

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

// No. + name + species + „Kitos žuvys“ + „IŠ VISO“
const SUMMARY_TOTAL_COL = 2 + SUMMARY_MAIN_COLUMNS.length + 2;
// One blank spacer column, then „Kontrolinė suma“ and the „Kitos žuvys“ breakdown.
const SUMMARY_CONTROL_COL = SUMMARY_TOTAL_COL + 2;
const SUMMARY_LAST_COL = SUMMARY_CONTROL_COL + SUMMARY_OTHER_COLUMNS.length + 2;
const SUMMARY_HEADER_ROW = 4;

type SummaryTotals = { main: number[]; other: number[] };

type PartySummary = {
  name: string;
  totals: SummaryTotals;
  byTool: Map<string, SummaryTotals>;
};

type SheetSummary = Map<string, Map<string, PartySummary>>;

export type CatchSummary = {
  all: SheetSummary;
  byMonth: Map<string, SheetSummary>;
  unmapped: Map<string, number>;
};

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
  toolType: string | null;
  location: CatchLocation | null;
  fishTypeId: string;
  kg: number;
};

type ColumnSlot = { group: keyof SummaryTotals; index: number; unmappedAs?: string };

const emptyTotals = (): SummaryTotals => ({
  main: SUMMARY_MAIN_COLUMNS.map(() => 0),
  // +1 for the trailing „Kitos“ column.
  other: [...SUMMARY_OTHER_COLUMNS.map(() => 0), 0],
});

const addTotals = (target: SummaryTotals, source: SummaryTotals) => {
  source.main.forEach((value, i) => (target.main[i] += value));
  source.other.forEach((value, i) => (target.other[i] += value));
};

const round2 = (value: number) => Math.round(value * 100) / 100;

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

// Registry spelling differs per environment (dev `karpiai`, prod `Karpis`);
// what still does not match goes to the diagnostics sheet, not silently to „Kitos“.
const normalizeLabel = (label: string) => label.trim().toLowerCase().replace(/\s+/g, ' ');

const indexByLabel = (columns: SummaryColumn[]) =>
  new Map(
    columns.flatMap((column, index) =>
      column.labels.map((label) => [normalizeLabel(label), index] as const),
    ),
  );

const MAIN_INDEX_BY_LABEL = indexByLabel(SUMMARY_MAIN_COLUMNS);
const OTHER_INDEX_BY_LABEL = indexByLabel(SUMMARY_OTHER_COLUMNS);
const OTHER_REST_INDEX = SUMMARY_OTHER_COLUMNS.length;

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
        return [{ ...base, fishTypeId, kg, toolType: null, location: null }];
      }

      const parts = splitProportionally(
        kg,
        weighed.map((boatRow) => kgOf(boatRow.data, fishTypeId)),
      );

      return weighed.map((boatRow, index) => ({
        ...base,
        fishTypeId,
        kg: parts[index],
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

// Fail closed: unknown ids give an empty set (empty report), never null (everything).
export const selectLabels = (labelById: Map<string, string>, ids?: string[]) => {
  if (!ids?.length) return null;

  return new Set(
    ids.map((id) => labelById.get(String(id))).filter((label): label is string => !!label),
  );
};

const resolveColumn = (
  entry: CatchEntry,
  labelById: Map<string, string>,
  selectedLabels: Set<string> | null,
): ColumnSlot | null => {
  const label = labelById.get(entry.fishTypeId);

  // A deleted species has no label: dropped under a species filter, otherwise
  // kept in „Kitos“ so the total holds.
  if (!label) {
    if (selectedLabels) return null;
    return { group: 'other', index: OTHER_REST_INDEX, unmappedAs: `ID ${entry.fishTypeId}` };
  }

  if (selectedLabels && !selectedLabels.has(label)) return null;

  const normalized = normalizeLabel(label);

  const mainIndex = MAIN_INDEX_BY_LABEL.get(normalized);
  if (mainIndex !== undefined) return { group: 'main', index: mainIndex };

  const otherIndex = OTHER_INDEX_BY_LABEL.get(normalized);
  if (otherIndex !== undefined) return { group: 'other', index: otherIndex };

  return { group: 'other', index: OTHER_REST_INDEX, unmappedAs: label };
};

const addToSheet = (sheet: SheetSummary, entry: CatchEntry, slot: ColumnSlot) => {
  const parties = getOrCreate(sheet, entry.fishingType, () => new Map<string, PartySummary>());
  const party = getOrCreate(parties, entry.partyKey, () => ({
    name: entry.partyName,
    totals: emptyTotals(),
    byTool: new Map<string, SummaryTotals>(),
  }));
  const tool = getOrCreate(party.byTool, entry.toolType || SUMMARY_UNASSIGNED_TOOL, emptyTotals);

  party.totals[slot.group][slot.index] += entry.kg;
  tool[slot.group][slot.index] += entry.kg;
};

export const summarizeCatch = (
  entries: CatchEntry[],
  opts: { labelById: Map<string, string>; selectedLabels: Set<string> | null },
): CatchSummary => {
  const summary: CatchSummary = { all: new Map(), byMonth: new Map(), unmapped: new Map() };

  for (const entry of entries) {
    const slot = resolveColumn(entry, opts.labelById, opts.selectedLabels);
    if (!slot) continue;

    // Counted in „Kitos“ but also listed, so a renamed species gets noticed.
    if (slot.unmappedAs) {
      summary.unmapped.set(
        slot.unmappedAs,
        (summary.unmapped.get(slot.unmappedAs) || 0) + entry.kg,
      );
    }

    addToSheet(summary.all, entry, slot);
    addToSheet(
      getOrCreate(summary.byMonth, entry.month, () => new Map()),
      entry,
      slot,
    );
  }

  return summary;
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

const monthSheetName = (month: string, spansYears: boolean) =>
  spansYears ? month : month.slice(5);

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
  fishTypes: Set<string> | null;
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
    `Rūšys: ${listOrAll(filter.fishTypes, 'visos')}`,
  ].join(' · ');
};

// Reference invariant: „IŠ VISO“ = „Kontrolinė suma“ = species + „Kitos žuvys“,
// and the breakdown's „IŠ VISO“ = „Kitos žuvys“.
const summaryRowValues = (first: string | number, name: string, totals: SummaryTotals) => {
  const other = round2(sum(totals.other));
  const total = round2(sum(totals.main) + other);

  return [
    first,
    name,
    ...totals.main.map(round2),
    other,
    total,
    null,
    total,
    ...totals.other.slice(0, SUMMARY_OTHER_COLUMNS.length).map(round2),
    round2(totals.other[SUMMARY_OTHER_COLUMNS.length]),
    other,
  ];
};

type SheetLayout = {
  periodLine: string;
  filterLine: string;
  zones: SummaryZone[];
  showToolTypes: boolean;
};

const renderSheetHeader = (sheet: ExcelJS.Worksheet, layout: SheetLayout) => {
  sheet.views = [{ state: 'frozen', xSplit: 2, ySplit: SUMMARY_HEADER_ROW }];

  sheet.mergeCells(1, 1, 1, SUMMARY_LAST_COL);
  sheet.getCell(1, 1).value = SUMMARY_TITLE;
  sheet.getCell(1, 1).font = { bold: true };
  sheet.getCell(1, 1).alignment = { horizontal: 'center', wrapText: true };

  sheet.mergeCells(2, 1, 2, SUMMARY_LAST_COL);
  sheet.getCell(2, 1).value = layout.periodLine;
  sheet.getCell(2, 1).alignment = { horizontal: 'center' };

  sheet.mergeCells(3, 1, 3, SUMMARY_TOTAL_COL);
  sheet.getCell(3, 1).value = layout.filterLine;

  sheet.mergeCells(3, SUMMARY_CONTROL_COL, 3, SUMMARY_LAST_COL);
  sheet.getCell(3, SUMMARY_CONTROL_COL).value = 'Kitos žuvys :';
  sheet.getCell(3, SUMMARY_CONTROL_COL).font = { bold: true };

  const headerRow = sheet.getRow(SUMMARY_HEADER_ROW);
  headerRow.values = [
    'Eil. Nr.',
    layout.showToolTypes
      ? 'ĮMONĖS (ORGANIZACIJOS) PAVADINIMAS / ĮRANKIO TIPAS'
      : 'ĮMONĖS (ORGANIZACIJOS) PAVADINIMAS',
    ...SUMMARY_MAIN_COLUMNS.map((column) => column.header),
    'Kitos žuvys',
    'IŠ VISO',
    null,
    'Kontrolinė suma (iš viso)',
    ...SUMMARY_OTHER_COLUMNS.map((column) => column.header),
    'Kitos',
    'IŠ VISO',
  ];
  headerRow.font = { bold: true };
  headerRow.alignment = { wrapText: true, vertical: 'bottom' };

  sheet.getColumn(1).width = 8;
  sheet.getColumn(2).width = layout.showToolTypes ? 46 : 38;
  for (let column = 3; column <= SUMMARY_LAST_COL; column++) {
    sheet.getColumn(column).width = column === SUMMARY_TOTAL_COL + 1 ? 3 : 12;
  }
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
) => {
  let rowIndex = startRow;
  for (const [toolType, totals] of sortedToolRows(byTool)) {
    const row = sheet.getRow(rowIndex++);
    row.values = summaryRowValues('', toolType, totals);
    row.getCell(2).alignment = { indent: 1 };
    if (toolType === SUMMARY_UNASSIGNED_TOOL) row.getCell(2).font = { italic: true };
  }
  return rowIndex;
};

const renderSummarySheet = (sheet: ExcelJS.Worksheet, data: SheetSummary, layout: SheetLayout) => {
  renderSheetHeader(sheet, layout);

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
      partyRow.values = summaryRowValues(index + 1, summary.name, summary.totals);

      if (layout.showToolTypes) {
        partyRow.font = { bold: true };
        rowIndex = renderToolRows(sheet, rowIndex, summary.byTool);
      }

      addTotals(zoneTotals, summary.totals);
    });

    const totalRow = sheet.getRow(rowIndex++);
    totalRow.values = summaryRowValues('', zone.totalLabel, zoneTotals);
    totalRow.font = { bold: true };

    addTotals(grandTotals, zoneTotals);
    rowIndex++;
  }

  const grandRow = sheet.getRow(rowIndex);
  grandRow.values = summaryRowValues('', 'IŠ VISO:', grandTotals);
  grandRow.font = { bold: true };
};

// Added only when something went unmapped, so a clean run matches the reference.
const appendUnmappedSheet = (workbook: ExcelJS.Workbook, unmapped: Map<string, number>) => {
  if (!unmapped.size) return;

  const sheet = workbook.addWorksheet('Nepriskirtos rūšys');

  sheet.getRow(1).values = [
    'Šios rūšys nepateko į nė vieną suvestinės stulpelį ir buvo priskaičiuotos prie „Kitos žuvys“.',
  ];
  sheet.getRow(1).font = { bold: true };

  const header = sheet.getRow(3);
  header.values = ['Rūšis registre', 'Kiekis, kg'];
  header.font = { bold: true };

  Array.from(unmapped.entries())
    .sort((a, b) => b[1] - a[1])
    .forEach(([label, kg], index) => {
      sheet.getRow(4 + index).values = [label, round2(kg)];
    });

  sheet.getColumn(1).width = 48;
  sheet.getColumn(2).width = 16;
};

export const buildCatchSummaryWorkbook = (
  summary: CatchSummary,
  opts: {
    period: SummaryPeriod;
    months: string[];
    types: string[];
    filterLine: string;
    showToolTypes: boolean;
  },
) => {
  const workbook = new ExcelJS.Workbook();
  const layout = {
    filterLine: opts.filterLine,
    zones: selectedZones(opts.types),
    showToolTypes: opts.showToolTypes,
  };

  renderSummarySheet(workbook.addWorksheet('Suvestinė'), summary.all, {
    ...layout,
    periodLine: `UŽ ${formatSummaryPeriod(opts.period)}`,
  });

  const spansYears =
    opts.months.length > 0 &&
    opts.months[0].slice(0, 4) !== opts.months[opts.months.length - 1].slice(0, 4);
  for (const month of opts.months) {
    renderSummarySheet(
      workbook.addWorksheet(monthSheetName(month, spansYears)),
      summary.byMonth.get(month) || new Map(),
      { ...layout, periodLine: `UŽ ${formatMonthTitle(month, opts.period)}` },
    );
  }

  appendUnmappedSheet(workbook, summary.unmapped);

  return workbook;
};
