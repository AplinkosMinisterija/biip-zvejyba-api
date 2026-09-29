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
| Rūšių stulpeliai | ~~Fiksuotas etaloninis AAD sąrašas~~ → visos `fish_types` registro rūšys (vadovo sprendimas, 2026-09-29). Žr. „Excel structure“ |
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
| `dateFrom`, `dateTo` | laikotarpis (`weight_events.date`, Vilniaus kalendorinė diena) |
| `types` | `ESTUARY` / `INLAND_WATERS` / `POLDERS` masyvas |
| `locationId` + `locationName` | konkretus kvadratas / telkinys / polderis |
| `fishTypes` | rūšių id masyvas |
| `byMonths`, `byToolTypes` | mėnesių lapai / įrankių eilutės po įmone |

Imami **tik krantiniai svėrimai** (`tools_group_id IS NULL`) — tai oficialus
tiksliai pasvertas kiekis, kurį etaloninė lentelė ir raportuoja.

Agregacija — **raw SQL** pagal CLAUDE.md taisyklę: moleculer DSL + secure id
+ ProfileMixin sluoksniai tokiems skaičiavimams neperžiūrimi.

Užklausa sąmoningai **apeina ProfileMixin scope'ą** — tai ir yra naujoji
duomenų ekspozicija, todėl vienintelis vartai yra `auth: INVESTIGATOR`.

### `services/api.service.ts`

`authorize()` `INVESTIGATOR` šaka priima ir `ADMIN`/`SUPER_ADMIN`
(administratorius ⊇ mokslininkas).

### Excel structure

Decision 2026-09-29 (head of unit): no fixed AAD reference columns, no
„Kitos žuvys“ block, no control sum — the columns come from our own
`fish_types` registry.

```
1  ŽVEJYBOS VERSLINĖS ŽVEJYBOS ĮRANKIAIS ... ATASKAITŲ SUVESTINĖ (KG.)
2  UŽ <period>
3  Vieta: … · Kvadratas: … · Rūšys: …
4  Eil. Nr. | ĮMONĖS (ORGANIZACIJOS) PAVADINIMAS | <every registry species> | IŠ VISO
5+ one block per picked zone — company rows (+ tool rows) and the zone total;
   then the grand „IŠ VISO:“
```

- Columns: every species in `fish_types`, ordered like the app's weighing
  form (priority, then name), each under its registry label. A deleted
  species appears only while old weigh-ins still carry its kg, so no catch
  drops out of the totals.
- With a species filter: only the picked species, in the order picked.
- `IŠ VISO` = the sum of the species columns.

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
4. ~~Stulpeliai, blokai ir kontrolinė suma atitinka etaloną~~ — replaced by registry columns (2026-09-29)
5. Paprastas žvejys (USER be INVESTIGATOR) į `researches.catchSummary` gauna 401/403
6. Abu PR'ai draft, užduotis prisegta

## Ne šiame darbe

- Etalono migracijos blokai (stintų / upinių nėgių) — nemodeliuojam laikotarpio
- Fizinių asmenų nuasmeninimas — etalone jie vardais, paliekam taip pat

## Stage 2 — split by month, tool type and bar (biip-zvejyba-api#162)

- **Attribution.** Only boat weigh-ins (`weight_events.tools_group_id` set)
  know the gear (`tools_groups.tools` → `tool_types`) and the bar (the group's
  build-event `location`). Each species' shore kg is split over the same
  fishing's boat weigh-ins in proportion to their kg for that species, in whole
  cents so the parts add back up. A species never weighed on the boat stays
  unattributed → row „Įrankis nenurodytas", and it drops out under a bar
  filter. There is no tool-type filter: the report always covers every tool
  (product decision, 2026-09-29).
- **Months.** Bucketed by the shore weigh-in's Vilnius calendar day. Every
  month of the period gets a sheet, always named `YYYY-MM` (product decision,
  2026-09-29 — not `01`… as the issue sketched); more than 120 sheets is
  rejected.
- **Species filter.** With species picked, the sheets show only their columns,
  headed by the registry label in the order picked, plus „IŠ VISO“. With none
  picked, every registry species (see „Excel structure“).
- **Blocks.** Only the picked zones are drawn; none picked = all three.
- **Header.** Row 3 lists every filter, unset ones as „visi" / „visos".
- Pure logic lives in `modules/catchSummary.ts`; the service keeps the SQL.
- FE: `DynamicFilter` cannot show, hide or clear a field from another field's
  draft value, so `/suvestine` uses its own filter popup built from
  design-system fields.
