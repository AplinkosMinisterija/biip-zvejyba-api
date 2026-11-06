# catchSummary — area note

Builds the scientists' Excel of commercial catch (kg per company × species ×
zone, optionally per month and per gear) out of the weigh-in events.

## Files that matter
- `modules/catchSummary.ts` — all of it: allocation, filtering, aggregation,
  workbook rendering.
- `services/researches.service.ts › catchSummary` — the action: params, role
  gate, the two SQL fetchers, the month cap.

## Invariants
- The official figure is the **shore** weigh-in, which carries neither gear nor
  bar; both live on the **boat** weigh-ins of the same fishing. So each species'
  shore kg is split over those weigh-ins in whole cents
  (`splitProportionally`) — the parts always add back to the shore total.
- Kg no boat weigh-in covers lands under `SUMMARY_UNASSIGNED_TOOL` and sorts
  last (`sortedToolRows`); `filterByToolTypes` therefore drops it by design.
- A location matches on id AND name (`filterByLocation`) — polder and bar ids
  collide.
- `selectedZones` draws only the picked zones, and all three when none is
  picked. INLAND_WATERS stays in `SUMMARY_ZONES` even though the frontend no
  longer offers it as a filter, so its catch keeps counting in „IŠ VISO“.
- `SUMMARY_HEADER_ROW = 4`: rows 1–3 are title / period / filter line. The
  frozen pane and every test index off it.
- The gear subtotals (`SUMMARY_ZONE_TOOL_TOTALS_LABEL`) are per zone across all
  companies, rendered only with `byToolTypes`, and sum to that zone's total row
  (`renderZoneBlock`).
- Month sheets are always named `YYYY-MM`, capped by
  `SUMMARY_MAX_MONTH_SHEETS`; past it the action throws `PERIOD_TOO_LONG`.

## Contract
Action `researches.catchSummary` (`GET /researches/catchSummary`), auth
`RestrictionType.INVESTIGATOR`, cross-tenant by design (it bypasses
`ProfileMixin`, so the role is the only gate). Params: `types[]`, `locationId` +
`locationName`, `fishTypes[]`, `toolTypes[]`, `dateFrom` / `dateTo`,
`byMonths`, `byToolTypes`. Answers an xlsx stream.

## Traps
- `describeSummaryFilters` output is asserted verbatim in both
  `test/unit/catch-summary.spec.ts` and
  `test/integration/api/researches-catch-summary-split.spec.ts` — renaming a
  label is a four-file change.
- Requiring the module outside Moleculer needs `FREELANCER_GROUP_ID` and
  `AUTH_INVESTIGATOR_GROUP_ID` (`types/constants.ts` fails fast on import).
- Integration tests need the local postgres on 5644:
  `docker compose -p biip-zvejyba-api up -d postgres`.
- A row-dump of a generated workbook is the cheapest way to check layout
  (indentation, subsection placement) — assertions prove the numbers, not how
  the sheet reads.

_Updated 2026-11-06._
