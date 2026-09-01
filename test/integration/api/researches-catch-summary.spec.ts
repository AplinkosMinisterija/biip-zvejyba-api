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

// Kiekviena zona turi savo bloką, tad sėjam po žvejybą skirtingiems tenant'ams
// ir skirtingiems tipams — taip patikrinam ir blokų atskyrimą.
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

// Suranda eilutę pagal B stulpelį (pavadinimą).
const findRow = (sheet: any, name: string) => {
  let found: any[] | null = null;
  sheet.eachRow((row: any, index: number) => {
    if (found) return;
    if (row.getCell(2).value === name) found = cellValues(sheet, index);
  });
  return found;
};

beforeAll(async () => {
  await broker.start();
  await apiHelper.setup();

  investigator = await apiHelper.makeAuthUser();
  MockAuthState.setPermissions(investigator.authUser.id, {
    FISHING: { accesses: ['INVESTIGATOR'] },
  });

  const fishTypes: any[] = await broker.call('fishTypes.find');
  fishTypeIdByLabel = new Map(fishTypes.map((fish) => [fish.label, fish.id]));

  // Karšis → pagrindinis stulpelis, Perpelė → „kitos žuvys" detalizacija,
  // Seliava → nei ten, nei ten, tad turi kristi į detalizacijos „Kitos".
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

  // Gateway'us sukasi su `mappingPolicy: 'all'`, tad veiksmas pasiekiamas ir
  // per fallback URL'ą — rolė turi galioti ir ten (CLAUDE.md → „Action
  // exposure").
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

  // Administratorius neturi INVESTIGATOR prieigos flag'o, bet turi matyti
  // viską, ką mato mokslininkas (api.service `authorize` supersetas).
  it('lets an ADMIN download the xlsx too', async () => {
    await request(apiService.server)
      .get(url)
      .set(apiHelper.getHeaders(apiHelper.adminA.token))
      .expect(200);
  });
});

describe('researches.catchSummary — sheet', () => {
  it('lays the columns out like the AAD reference sheet', async () => {
    const buffer = await broker.call(
      'researches.catchSummary',
      {},
      { meta: apiHelper.meta(investigator) },
    );
    const header = cellValues(await loadSheet(buffer), 4);

    expect(header[0]).toBe('Eil. Nr.');
    expect(header[1]).toBe('ĮMONĖS (ORGANIZACIJOS) PAVADINIMAS');

    // Visas sąrašas, ne pavyzdys. Etalono CSV `Š`/`Ž` numeta visai
    // (`KURŠIŲ` → `KURI?`), tad iš jo skaitomi pavadinimai lengvai iškraipomi —
    // taip `Aukšlė` buvo virtusi `Auklė` ir aukšlės krisdavo į „Kitos".
    expect(header.slice(2, 19)).toEqual([
      'Karšis',
      'Starkis',
      'Kuoja',
      'Lydeka',
      'Ešerys',
      'Ungurys',
      'Karosas',
      'Vėgėlė',
      'Stinta',
      'Lynas',
      'Nėgė',
      'Žiobris',
      'Plakis',
      'Salatis',
      'Šamas',
      'Ožka',
      'Karpis',
    ]);
    expect(header[19]).toBe('Kitos žuvys');
    expect(header[20]).toBe('IŠ VISO');
    expect(header[22]).toBe('Kontrolinė suma (iš viso)');
    expect(header.slice(23, 36)).toEqual([
      'Perpelė',
      'Plačiakaktis',
      'Plekšnė',
      'Šapalas',
      'Sykas',
      'Pūgžlys',
      'Dyglė',
      'Meknė',
      'Raudė',
      'Strimelė',
      'Aukšlė',
      'Šlakis',
      'Lašiša',
    ]);
    expect(header[36]).toBe('Kitos');
    expect(header[37]).toBe('IŠ VISO');
  });

  it('sums a tenant into the right zone and folds unlisted species into „Kitos"', async () => {
    const buffer = await broker.call(
      'researches.catchSummary',
      {},
      { meta: apiHelper.meta(investigator) },
    );
    const sheet = await loadSheet(buffer);

    expect(cellValues(sheet, 5)[0]).toBe('KURŠIŲ MARIOSE:');

    const row = findRow(sheet, 'Company-A')!;
    expect(row).toBeTruthy();
    expect(row[2]).toBe(10); // Karšis
    expect(row[19]).toBe(10); // Kitos žuvys = Perpelė 4 + Seliava 6
    expect(row[20]).toBe(20); // IŠ VISO
    expect(row[22]).toBe(20); // Kontrolinė suma
    expect(row[23]).toBe(4); // Perpelė
    expect(row[36]).toBe(6); // Seliava → „Kitos"
    expect(row[37]).toBe(10); // detalizacijos IŠ VISO = Kitos žuvys
  });

  it('keeps each zone in its own block and totals them all', async () => {
    const buffer = await broker.call(
      'researches.catchSummary',
      {},
      { meta: apiHelper.meta(investigator) },
    );
    const sheet = await loadSheet(buffer);

    expect(findRow(sheet, 'I VISO (Kuršių mariose):')![20]).toBe(20);
    expect(findRow(sheet, 'I viso polderiuose:')![20]).toBe(5);
    // Company-B žvejojo polderiuose, tad į Kuršių marių bloką patekti negali.
    expect(findRow(sheet, 'I viso Nemuno žemupyje, Šventosios upėje:')![20]).toBe(0);
    expect(findRow(sheet, 'IŠ VISO:')![20]).toBe(25);
  });

  it('narrows the totals when a fish-type filter is applied', async () => {
    const buffer = await broker.call(
      'researches.catchSummary',
      { fishTypes: [String(fishTypeIdByLabel.get('Karšis'))] },
      { meta: apiHelper.meta(investigator) },
    );
    const row = findRow(await loadSheet(buffer), 'Company-A')!;

    expect(row[2]).toBe(10); // Karšis liko
    expect(row[19]).toBe(0); // Perpelė ir Seliava atfiltruotos
    expect(row[20]).toBe(10);
  });

  it('narrows the totals when a fishing-type filter is applied', async () => {
    const buffer = await broker.call(
      'researches.catchSummary',
      { type: 'POLDERS' },
      { meta: apiHelper.meta(investigator) },
    );
    const sheet = await loadSheet(buffer);

    expect(findRow(sheet, 'Company-A')).toBeNull();
    expect(findRow(sheet, 'IŠ VISO:')![20]).toBe(5);
  });

  it('excludes catches outside the requested period', async () => {
    const buffer = await broker.call(
      'researches.catchSummary',
      { dateFrom: '2000-01-01', dateTo: '2000-12-31' },
      { meta: apiHelper.meta(investigator) },
    );

    expect(findRow(await loadSheet(buffer), 'IŠ VISO:')![20]).toBe(0);
  });

  // Dev registre rūšys vadinosi `karpiai`/`ešeriai`, prod — `Karpis`/`Ešerys`,
  // ir visa suvestinė tyliai virsdavo „Kitos žuvys". Registro rašyba per
  // aplinkas skiriasi, tad sutapdinimas privalo būti atsparus, o nesutapimas
  // matomas.
  describe('registro rašybos atsparumas', () => {
    const buildSheet = async (labelById: Map<number, string>, data: Record<string, number>) => {
      const service: any = broker.getLocalService('researches');
      const workbook = service.buildCatchSummaryWorkbook(
        [
          {
            fishing_type: 'ESTUARY',
            tenant_name: 'Rašybos UAB',
            first_name: null,
            last_name: null,
            data,
          },
        ],
        { labelById, selectedLabels: null, from: null, to: null },
      );
      return workbook;
    };

    it('sutapdina nepaisant raidžių registro ir tarpų', async () => {
      const workbook = await buildSheet(new Map([[1, '  KARPIS ']]), { '1': 5 });
      const sheet = workbook.getWorksheet('Suvestinė');

      const row = findRow(sheet, 'Rašybos UAB')!;
      expect(row[18]).toBe(5); // Karpis, ne „Kitos žuvys"
      expect(row[19]).toBe(0);
      expect(workbook.getWorksheet('Nepriskirtos rūšys')).toBeUndefined();
    });

    it('nepriskirtą rūšį suskaičiuoja į „Kitos" IR išveda atskirame lape', async () => {
      const workbook = await buildSheet(new Map([[1, 'karpiai']]), { '1': 7 });

      const row = findRow(workbook.getWorksheet('Suvestinė'), 'Rašybos UAB')!;
      expect(row[18]).toBe(0); // į Karpis stulpelį nepateko
      expect(row[19]).toBe(7); // bet bendra suma nenukentėjo
      expect(row[20]).toBe(7);

      const diagnostics = workbook.getWorksheet('Nepriskirtos rūšys')!;
      expect(diagnostics).toBeDefined();
      expect(cellValues(diagnostics, 4)).toEqual(['karpiai', 7]);
    });

    it('ištrintą rūšį išveda pagal id', async () => {
      const workbook = await buildSheet(new Map(), { '999': 3 });
      expect(cellValues(workbook.getWorksheet('Nepriskirtos rūšys')!, 4)).toEqual(['ID 999', 3]);
    });
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
