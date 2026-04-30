export interface TenantImportData {
  code: string;
  name: string;
  email?: string;
  phone?: string;
}

// One-time import dataset. Run via `POST /tenants/importBatch`.
export const TENANTS_TO_IMPORT: TenantImportData[] = [
  { code: '152746881', name: 'Z. Kairio firma', phone: '+37069811730', email: 'zigis.kairys@gmail.com' },
  { code: '152763279', name: 'Alvido Kazlausko įmonė', phone: '+37068660779', email: 'alvidasnida@gmail.com' },
  { code: '152764032', name: 'Antano Šimkevičiaus įmonė', email: 'marytezab@gmail.com' },
  { code: '152763845', name: 'Arvydo Bakevičiaus firma', phone: '+37068739576', email: 'bakeviciusa@gmail.com' },
  { code: '152740280', name: 'Edvardo Stulgaičio įmonė', phone: '+37061064762', email: 'edvardas.stulgaitis@gmail.com' },
  { code: '152730891', name: 'J. Šato žuvies apdirbimo įmonė', email: 'birute.radze@gmail.com' },
  { code: '152759619', name: 'Kauneckių UAB', phone: '+37068546504', email: 'rkauneckis@gmail.com' },
  { code: '687928', name: 'Rimvydo Kriščiūno ind. įm.', email: 'info@jurosvejas.lt' },
  { code: '152720783', name: 'S. Pociaus gintaro apdirbimo ir realizavimo įmonė', email: 'marytezab@gmail.com' },
  { code: '152731993', name: 'V. Chlebavičiaus personalinė įmonė', phone: '+37068089380', email: 'undinejurate@gmail.com' },
  { code: '177167582', name: 'V. Eidukonienės individuali įmonė', phone: '+37069995251', email: 'vidaeidukoniene@gmail.com' },
  { code: '152756128', name: 'MB "Bridinys"', email: 'rita.eiciniene@gmail.com' },
  { code: '152727767', name: 'Z. Lubio personalinė įmonė', phone: '+37068516519', email: 'zolenaslubys@gmail.com' },
  { code: '177163413', name: 'UAB „Astviras"', phone: '+37064023505', email: 'juozas.vrubliauskas@gmail.com' },
  { code: '152763126', name: 'UAB „Juodkrantės žvejys"', email: 'karolistamulis32@gmail.com' },
  { code: '252736240', name: 'UAB „Jūros vėjas"', phone: '+37069818363', email: 'info@jurosvejas.lt' },
  { code: '152763083', name: 'UAB „Kintų rūkytos žuvys"', phone: '+37060492059', email: 'kinturukytazuvis@gmail.com' },
  { code: '152706068', name: 'UAB „Kopos"', phone: '+37067284686', email: 'kopos20@gmail.com' },
  { code: '177422428', name: 'UAB „Marių ežia"', phone: '+37063529684', email: 'saulius1232@inbox.lt' },
  { code: '152730172', name: 'UAB „Marių kelmukas"', phone: '+37068636409', email: 'arunaszuvis@gmail.com' },
  { code: '177404362', name: 'UAB „Nemuno žuvis"', phone: '+37061276356', email: 'saulius1232@inbox.lt' },
  { code: '177243279', name: 'UAB „Pamarėnas"', phone: '+37068757582', email: '013pamarenas@gmail.com' },
  { code: '300026681', name: 'UAB „Pamario žuvis"', phone: '+37060894841', email: 'pamariozuvytes@gmail.com' },
  { code: '252763650', name: 'UAB "Preilos žvejys"', email: 'karolistamulis32@gmail.com' },
  { code: '177117031', name: 'UAB „Riepa"', phone: '+37068548074', email: 'riepa1971@gmail.com' },
  { code: '301064539', name: 'UAB "Rusnaitės žuvis"', email: 'rusnaiteszuvys@gmail.com' },
  { code: '158994976', name: 'UAB „Storasis ungurys"', phone: '+37068240213', email: 'kuzma.dalius@gmail.com' },
  { code: '177081998', name: 'UAB „Tatamiškis"', phone: '+37060535535', email: 'nerijusjankauskas47@gmail.com' },
  // Source spreadsheet has the same code (177243279) for Pamarėnas and
  // Uostadvaris — likely a typo. Verify the real Uostadvaris company
  // code before re-running if the import errors out as a duplicate.
  { code: '177243279', name: 'UAB „Uostadvaris"', phone: '+37068240213', email: 'kuzma.dalius@gmail.com' },
  { code: '177150533', name: 'UAB „Venteris"', phone: '+37061278387', email: 'venteris.uab@gmail.com' },
  { code: '277337530', name: 'UAB „Ventžuvė"', phone: '+37065271773', email: 'antaninaadomaityte@gmail.com' },
  { code: '152704626', name: 'Visuomeninio maitinimo UAB „Edita"', phone: '+37065659578' },
  { code: '163193154', name: 'UAB „Žuvaita"', phone: '+37065659578', email: 'slp.zuvis@gmail.com' },
  { code: '305438233', name: 'UAB "Rusnės rūkintojai"', phone: '+37064457764', email: 'gedvilasgiedrius@gmail.com' },
  { code: '177295685', name: 'UAB „Atmatos upė"', phone: '+37068579637', email: 'zvejai.lampetros@gmail.com' },
  { code: '300150227', name: 'UAB „Pamario krašto projektai"', phone: '+37061213493', email: 'pkprojektai@gmail.com' },
  { code: '177405998', name: 'S. Jakubauskienės įmonė', phone: '+37068757634', email: 'zvejai.lampetros@gmail.com' },
  // Personal code listed as the company identifier for the sole proprietor.
  { code: '38911301407', name: 'Karolis Tamulis', email: 'karolistamulis32@gmail.com' },
];
