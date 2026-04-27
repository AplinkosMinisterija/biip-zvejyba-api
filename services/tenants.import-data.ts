export interface TenantImportData {
  code: string;
  name: string;
  email?: string;
  phone?: string;
}

// One-time import dataset. Run via `POST /tenants/importBatch`.
// Companies present in only one source (no code, or no email) are kept where possible
// and skipped at runtime when the required `code` is missing.
export const TENANTS_TO_IMPORT: TenantImportData[] = [
  { code: '152763845', name: 'Arvydo Bakevičiaus firma', email: 'bakeviciusa@gmail.com' },
  {
    code: '152731993',
    name: 'V. Chlebavičiaus personalinė įmonė',
    email: 'undinejurate@gmail.com',
  },
  {
    code: '177167582',
    name: 'V. Eidukonienės individuali įmonė',
    email: 'vidaeidukoniene@gmail.com',
  },
  { code: '152746881', name: 'Z. Kairio firma', email: 'zigis.kairys@gmail.com' },
  { code: '152759619', name: 'Kauneckių UAB', email: 'rkauneckis@gmail.com' },
  { code: '152763279', name: 'Alvido Kazlausko įmonė', email: 'alvidasnida@gmail.com' },
  { code: '687928', name: 'Rimvydo Kriščiūno ind. įm.', email: 'jurosvejas@inbox.lt' },
  { code: '152727767', name: 'Z. Lubio personalinė įmonė', email: 'zolenaslubys@gmail.com' },
  {
    code: '152720783',
    name: 'S. Pociaus gintaro apdirbimo ir realizavimo įmonė',
    email: 'marytezab@gmail.com',
  },
  { code: '152740280', name: 'Edvardo Stulgaičio įmonė', email: 'edvardas.stulgaitis@gmail.com' },
  { code: '152730891', name: 'J. Šato žuvies apdirbimo įmonė', email: 'birute.radze@gmail.com' },
  { code: '152764032', name: 'Antano Šimkevičiaus įmonė', email: 'marytezab@gmail.com' },
  // Personal code listed as the company identifier for the sole proprietor.
  { code: '38911301407', name: 'Karolis Tamulis', email: 'karolistamulis32@gmail.com' },
  { code: '171183413', name: 'UAB "Astviras"', email: 'juozas.vrubliauskas@gmail.com' },
  { code: '152704626', name: 'Visuomeninio maitinimo UAB "Edita"', email: 'lina.kintai@gmail.com' },
  {
    code: '152763126',
    name: 'UAB "Juodkrantės žvejys"',
    email: 'karolistamulis32@gmail.com',
  },
  { code: '252736240', name: 'UAB "Jūros vėjas"', email: 'jurosvejas@inbox.lt' },
  { code: '152763083', name: 'UAB "Kintų rūkytos žuvys"', email: 'kinturukytazuvis@gmail.com' },
  { code: '152706068', name: 'UAB "Kopos"', email: 'kopos20@gmail.com' },
  { code: '177422428', name: 'UAB "Marių ežia"', email: 'saulius1232@inbox.lt' },
  { code: '152730172', name: 'UAB "Marių kelmukas"', email: 'arunaszuvis@gmail.com' },
  { code: '177404362', name: 'UAB "Nemuno žuvis"', email: 'saulius1232@gmail.com' },
  { code: '177243279', name: 'UAB "Pamarėnas"', email: '013pamarenas@gmail.com' },
  { code: '300026681', name: 'UAB "Pamario žuvis"', email: 'pamariozuvytes@gmail.com' },
  { code: '252763650', name: 'UAB "Preilos žvejys"', email: 'karolistamulis32@gmail.com' },
  { code: '177117031', name: 'UAB "Riepa"', email: 'riepal971@gmail.com' },
  { code: '301064539', name: 'UAB "Rusnaitės žuvis"', email: 'rusnaiteszuvys@gmail.com' },
  { code: '158994976', name: 'UAB "Storasis ungurys"', email: 'kuzma.dalius@gmail.com' },
  { code: '177081998', name: 'UAB "Tatamiškis"', email: 'uabtatamiskis@gmail.com' },
  // Source list shows the same code (177243279) for Pamarėnas and Uostadvaris — likely OCR/typo;
  // verify the real company code before re-running if this row errors out as a duplicate.
  { code: '177150533', name: 'UAB "Venteris"', email: 'venteris.uab@gmail.com' },
  { code: '277337530', name: 'UAB "Ventžuvė"', email: 'antaninaadomaityte@gmail.com' },
  { code: '163193154', name: 'UAB "Žuvaita"', email: 'lina.kintai@gmail.com' },
  { code: '177405998', name: 'S. Jakubauskienės įmonė', email: 'zvejai.lampetros@gmail.com' },
  { code: '177295685', name: 'UAB "Atmatos upė"', email: 'zvejai.lampetros@gmail.com' },
  { code: '300150227', name: 'UAB "Pamario krašto projektai"', email: 'pkprojektai@gmail.com' },
  // Code-only rows (no email in the source spreadsheet).
  { code: '152756128', name: 'MB "Bridinys"' },
  { code: '152778886', name: 'UAB "LUŽĖ"' },
  { code: '305438233', name: 'UAB "Rusnės rūkintojai"' },
];
