# Mokslininkų prieiga: verslinių sugavimų suvestinė

**Data:** 2026-09-01
**Užduotis:** Project 18 → „prieiga mokslui" (draft issue, itemId 234573829)
**Repo:** `biip-zvejyba-api` + `biip-zvejyba-web`

## Problema

Gamtos tyrimų centro mokslininkai iki šiol gaudavo verslinių sugavimų
duomenis rankomis suvestose Excel lentelėse. Užduotis — duoti jiems prieigą
prie BĮIS, kad patys galėtų nagrinėti sugavimus pagal laikotarpius, žvejybos
vietas ir įrankius.

`RestrictionType.INVESTIGATOR` rolė sistemoje jau yra, bet mokslininkas
prisijungęs mato **visą žvejo funkcionalumą** (Mano žvejyba, Žvejybos
žurnalas, Nariai, Įrankiai) — jam nereikalingą ir klaidinantį.

## Sprendimas

Mokslininkui paliekam tik du dalykus: **Suvestinę** (filtruojamas Excel
eksportas per visas įmones) ir esamą **Mokslinių tyrimų** tabą.

### Apimties sprendimai

| Klausimas | Sprendimas |
|---|---|
| Kurioje aplikacijoje | `biip-zvejyba-web`. Mokslininkas yra USER tipo paskyra, o `RestrictionType.ADMIN` reikalauja ADMIN tipo — į admin portalą jis fiziškai negali įeiti |
| Kodo vieta | `researches.service.ts` — mokslininko servisas. Vienas endpoint'as nenusipelno nei atskiro serviso, nei modulio |
| Rūšių stulpeliai | Fiksuotas etaloninis sąrašas ir tvarka. Dinamiškas variantas stulpelius pastumtų vos adminui pridėjus rūšį — lentelė nustotų būti „identiška" |
| Migracijos blokai | Praleidžiam. „Stintų migracijos metu", „upinių nėgių migracijos metu" reikalautų modeliuoti migracijos laikotarpį — tokių duomenų neturim, o spėti blogiau nei nerodyti |
| Duomenų apimtis | Tik agreguota (kg pagal įmonę × rūšį × zoną), visos įmonės. Jokių koordinačių ir žurnalo eilučių |
| Filtrų opcijos | Jokių naujų endpoint'ų — `locations.getFishingSections` ir `fishTypes` sąrašas jau prieinami USER rolei |

## Backend (`biip-zvejyba-api`)

### `services/researches.service.ts`

Vienas naujas veiksmas. Servisas turi `DbConnection`, tad `this.rawQuery`
prieinamas iš karto — jokių tarpinių pagalbinių veiksmų nereikia.

```
GET /researches/catchSummary     auth: INVESTIGATOR
```

Parametrai (visi optional):

| Param | Reikšmė |
|---|---|
| `dateFrom`, `dateTo` | laikotarpis (`weight_events.date`) |
| `type` | `ESTUARY` / `INLAND_WATERS` / `POLDERS` |
| `locationId` + `locationName` | konkretus kvadratas / telkinys / polderis |
| `fishTypes` | rūšių id masyvas |

Imami **tik krantiniai svėrimai** (`tools_group_id IS NULL`) — tai oficialus
tiksliai pasvertas kiekis, kurį etaloninė lentelė ir raportuoja.

Agregacija — **raw SQL** pagal CLAUDE.md taisyklę: moleculer DSL + secure id
+ ProfileMixin sluoksniai tokiems skaičiavimams neperžiūrimi.

Užklausa sąmoningai **apeina ProfileMixin scope'ą** — tai ir yra naujoji
duomenų ekspozicija, todėl vienintelis vartai yra `auth: INVESTIGATOR`.

### `services/api.service.ts`

`authorize()` `INVESTIGATOR` šaka priima ir `ADMIN`/`SUPER_ADMIN`
(administratorius ⊇ mokslininkas).

### Excel struktūra

Lapas „Suvestinė":

```
1  ŽVEJYBOS VERSLINĖS ŽVEJYBOS ĮRANKIAIS ... ATASKAITŲ SUVESTINĖ (KG.)
2  UŽ <laikotarpis>
3  [grupės antraštė]                                  Kitos žuvys :
4  Eil.Nr. | PAVADINIMAS | <17 rūšių> | Kitos žuvys | IŠ VISO | | Kontrolinė suma | <13 rūšių> | Kitos | IŠ VISO
5+ KURŠIŲ MARIOSE       — įmonių eilutės + „IŠ VISO (Kuršių mariose)"
   santrauka            — Nemuno žemupys / Polderiai / bendra suma
   NEMUNO ŽEMUPYJE...   — įmonių eilutės + „Iš viso"
   POLDERIUOSE          — įmonių eilutės + „Iš viso"
```

Stulpelių tvarka (3–19): Karšis, Starkis, Kuoja, Lydeka, Ešerys, Ungurys,
Karosas, Vėgėlė, Stinta, Lynas, Nėgė, Žiobris, Plakis, Salatis, Šamas, Ožka,
Karpis.

Kitos žuvys detalizacija (24–36): Perpelė, Plačiakaktis, Plekšnė, Šapalas,
Sykas, Pūgžlys, Dyglė, Meknė, Raudė, Strimelė, Auklė, Šlakis, Lašiša.

Rūšių mapinimas pagal `fish_types.label`:

- `Starkis` ← `Sterkas`, `Sterkas (neverslinio dydžio)`
- `Karosas` ← `Karosas`, `Karosas, auksinis`, `Karosas, sidabrinis`
- likusios — tikslus sutapimas
- nerastos krenta į `Kitos žuvys`, o detalizacijoje — į `Kitos`

**Invariantas:** `IŠ VISO` = `Kontrolinė suma` = 17 rūšių + `Kitos žuvys`;
detalizacijos `IŠ VISO` = `Kitos žuvys`. Patikrinta etalone (Bakevičiaus A. f.
eilutė: 971 ir 40).

Etalono skiemenuoti stulpeliai („Lyde-/ka") **nekartojami** — tai siauro
stulpelio tipografijos artefaktas, ne duomenys. Pavadinimai rašomi pilni.

## Frontend (`biip-zvejyba-web`)

| Failas | Pakeitimas |
|---|---|
| `src/pages/Summary.tsx` | naujas — `DynamicFilter` + atsisiuntimo mygtukas |
| `src/utils/routes.tsx` | `slugs.summary = '/suvestine'`, route su `isInvestigator: true` |
| `src/utils/hooks.ts` | `useFilteredRoutes` — mokslininkui palieka tik `isInvestigator` route'us + Profilį |
| `src/utils/api.ts` | `getCatchSummary` |
| `src/utils/functions.ts` | `handleGetCatchSummaryExcel` |
| `src/utils/texts.ts` | filtrų etiketės |

Filtrai (`DynamicFilter`, kaip žvejybos žurnale): žvejybos rūšis, vietovė
(Kuršių marių kvadratai), **žuvų rūšys** (`multiselect`), laikotarpis nuo / iki.

Slėpimas FE pusėje yra **UX, ne apsauga** — žvejo endpoint'ai jau
ProfileMixin-scoped, tad mokslininko profilis matytų tik savo (tuščią)
žurnalą. Vienintelė reali nauja ekspozicija — cross-tenant suvestinė, ir ji
užrakinta `RestrictionType.INVESTIGATOR`.

## Acceptance

1. Mokslininkas nemato žvejo funkcionalumo — nei meniu, nei per tiesioginį URL
2. „Moksliniai tyrimai" tabas veikia kaip anksčiau
3. Suvestinės Excel atsisiunčiamas, filtrai veikia (t. p. pagal žuvis)
4. Stulpeliai, blokai ir kontrolinė suma atitinka etaloną
5. Paprastas žvejys (USER be INVESTIGATOR) į `researches.catchSummary` gauna 401/403
6. Abu PR'ai draft, užduotis prisegta

## Ne šiame darbe

- Etalono migracijos blokai (stintų / upinių nėgių) — nemodeliuojam laikotarpio
- Fizinių asmenų nuasmeninimas — etalone jie vardais, paliekam taip pat
