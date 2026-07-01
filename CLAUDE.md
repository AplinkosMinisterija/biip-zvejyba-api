# biip-zvejyba-api

Moleculer-based REST API for the Lithuanian commercial-fishing app
(Žvejyba). Pairs with [biip-zvejyba-web](../biip-zvejyba-web) and the
shared [biip-auth-api](../biip-auth-api). E-vartai login, multi-tenant
(įmonės), PostGIS geometry, Redis cache.

## Stack

- **Node 20**, TypeScript 5
- **Moleculer 0.14** + `moleculer-decorators`, `moleculer-web` API gateway
- **Postgres + PostGIS** via `knex` migrations (`knexfile.ts`); coordinates
  stored in **EPSG:3346 (LKS94)**, converted from WGS84 inputs
- **Redis** cache (1h TTL by default)
- **biip-auth-nodejs** mixin → biip-auth-api over HTTP+API key
- **MinIO** for object storage (fish-type photos, research files)
- Tests: Jest

## Repo layout

```
services/                 ~20 service files (one per entity / cross-cutting)
mixins/                   DbConnection, ProfileMixin
modules/geometry.ts       coordinatesToGeometry, geomToWgs (WGS84 ↔ LKS94)
types/
  ├─ constants.ts         RestrictionType, LocationType, COMMON_FIELDS,
  │                       COMMON_SCOPES, error helpers (throwUnauthorizedError, …)
  └─ moleculer.ts, polders.ts (where added), uploads.ts
database/migrations/      knex `YYYYMMDDHHmmss_description.js`
moleculer.config.ts       broker, replCommands, metrics, tracing
```

## Service catalogue

REST routes prefixed with `/zvejyba/api`.

| Service | Highlights |
|---|---|
| `api.service.ts` | API gateway, `authenticate`/`authorize`, sets `ctx.meta.{user, authUser, authToken, profile}` |
| `auth.service.ts` | E-vartai login hook (`afterUserLoggedIn`), syncs user + tenants from auth API |
| `users.service.ts` | Local user mirror; `users.findOne({ authUser })` is the canonical lookup |
| `tenants.service.ts` | Companies. `POST /invite` (admin), `tenants.importBatch` (custom REPL command). Soft-deletes via COMMON_SCOPES |
| `tenantUsers.service.ts` | User↔Tenant memberships, role: `OWNER`/`USER_ADMIN`/`USER`. `beforeCreate` calls `auth.users.assignToGroup` (token gotcha below) |
| `fishings.service.ts` | Active sessions. `POST /start`, `/end`, `/skip`, `GET /current`, `GET /weights`. Handles 3 types: `ESTUARY`, `INLAND_WATERS`, `POLDERS` |
| `fishingEvents.service.ts` | START/END/SKIP events (geom + type) |
| `weightEvents.service.ts` | Catches; preliminary (boat) and total (shore) keyed by toolsGroup |
| `toolsGroups.service.ts` | Deployed tool sets. `GET /toolsGroups/location/:id?locationType=…` filters by `buildEvent.fishing.type` to dodge polder/bar id collision |
| `toolsGroupsEvents.service.ts` | BUILD_TOOLS / REMOVE_TOOLS history (location stored as JSONB) |
| `tools.service.ts` | Sealed tools inventory |
| `toolTypes.service.ts` | NETS / CATCHERS taxonomy (seedDB) |
| `fishTypes.service.ts` | Fish species + priority for sorting |
| `polders.service.ts` | Static seed of 13 Nemuno žemupio polderiai (id, name, area) |
| `location.service.ts` | Stateless: UETK / GIS / municipality / fishing-section lookups + polder list. `getFishingSections` returns ESTUARY-typed bars |
| `researches.service.ts` + `.fishes` | Investigator research data |
| `minio.service.ts` | Signed-URL S3 access |
| `sentry.service.ts` | Error reporting |

## Domain model (high level)

```
Tenant 1—* TenantUser *—1 User
User 1—* Fishing 1—1 FishingEvent (start, end?, skip?)
        Fishing *—1 Polder?           # only when type=POLDERS
        Fishing *—* WeightEvent
ToolsGroup 1—1 ToolsGroupsEvent (build, remove?)  → location (JSONB)
ToolsGroup *—* Tool
WeightEvent *—1 ToolsGroup?           # null toolsGroup = preliminary catch
```

Every table inherits soft-delete (`createdAt/By`, `updatedAt/By`,
`deletedAt/By`) via `COMMON_FIELDS` + `COMMON_SCOPES.notDeleted` in
`COMMON_DEFAULT_SCOPES`.

Key enums (`types/constants.ts`, `services/fishings.service.ts`,
`services/tenantUsers.service.ts`):

- `FishingType` = `ESTUARY` | `INLAND_WATERS` | `POLDERS`
- `LocationType` = same values (used on JSONB location records)
- `RestrictionType` = `PUBLIC` | `DEFAULT` | `USER` | `ADMIN` | `INVESTIGATOR`
- `TenantUserRole` = `USER` | `USER_ADMIN` | `OWNER`
- `AuthGroupRole` = `USER` | `ADMIN` (auth-side)
- `FishingEventType` = `START` | `END` | `SKIP`
- `ToolsGroupHistoryTypes` = `BUILD_TOOLS` | `REMOVE_TOOLS`

## Cross-cutting patterns

### Auth & meta propagation

`authMixin` (biip-auth-nodejs) wraps each `auth.*.*` action and reads the
JWT from `ctx.meta.authToken`. The API gateway populates meta from the
`Authorization: Bearer …` header in `authenticate()`.

**The classic gotcha**: the original login request is anonymous (no
Bearer), so when an action *triggered by login* (e.g. `tenantUsers.create`
inside `afterUserLoggedIn`) eventually calls `auth.users.assignToGroup`,
it 401s — the inner mixin call sees `ctx.meta.authToken` undefined.

**Fix pattern**: propagate the freshly issued token explicitly:

```ts
const meta = { authToken: data.token };
await ctx.call('tenantUsers.create', params, { meta });
```

See `services/auth.service.ts` `afterUserLoggedIn` for the canonical
example.

### DbConnection mixin

`mixins/database.mixin.ts` wraps `@moleculer/database` + `moleculer-knex-filters`
and bakes in soft-delete + populate helpers. Every service follows:

```ts
@Service({
  name: 'foo',
  mixins: [DbConnection({ collection: 'foos' }), ProfileMixin /* if tenant-scoped */],
  settings: {
    fields: { id: { type: 'number', primaryKey: true, secure: true }, …, ...COMMON_FIELDS },
    scopes: { ...COMMON_SCOPES },
    defaultScopes: [...COMMON_DEFAULT_SCOPES],
    defaultPopulates: ['some'],
  },
  hooks: { before: { create: ['beforeCreate'], list: ['beforeSelect'], … } },
})
```

`PopulateHandlerFn('foos.populateByProp')` — generic populator by foreign
key. Use it instead of manual `Promise.all`.

### ProfileMixin

`mixins/profile.mixin.ts` filters list/find/get queries by
`ctx.meta.profile` (tenant) or `ctx.meta.user.id` for non-admins, and
auto-stamps `tenant`/`user` on creates. Drop into services that hold
tenant-owned data (fishings, toolsGroups, weightEvents, tools, …).

### Geometry

Inputs from clients are always `{ x: longitude, y: latitude }` (WGS84).
`modules/geometry.ts` `coordinatesToGeometry()` converts to PostGIS
`Point(LKS94, 3346)`. Reads come back through `geomToWgs()`. Don't store
WGS84 — it'll mismatch the `geom` column.

### Validator gotcha — `strict: 'remove'`

Moleculer's default object validator silently **drops** properties that
aren't listed in the schema. Two real incidents in this repo:

1. `LocationProp` had no `type` field → polder/estuary discriminator was
   stripped before hitting the JSONB column → `toolsGroupsByLocation`
   couldn't tell them apart. Always declare every JSONB property,
   including optional ones.
2. Same for `toolsGroupsEvents.location` field schema.

Rule of thumb: when a JSONB shape needs an optional field, write
`type: { type: 'string', optional: true }` explicitly.

### Tools-by-location collision

Polder ids and estuary bar ids both come from small integers and **can
collide** (polder id 1 vs bar 1). `toolsGroupsByLocation` filters by
`buildEvent.fishing.type` (always populated, no migration needed) — *not*
by stored `location.type` (legacy rows have it null). Don't change this
without re-thinking the legacy fallback.

### Action exposure — `mappingPolicy: 'all'` publishes EVERY action

The gateway (`api.service.ts`) runs `mappingPolicy: 'all'` + `whitelist:
['**']`, so moleculer-web's fallback URL serves **any `published` action**
at `POST /zvejyba/api/<service>/<action>` — `rest: null` does NOT hide it
(only `visibility: 'protected'`/`'private'` does). Two consequences when
adding code:

1. **A destructive/internal action with no `auth` is reachable by any USER.**
   `getRestrictionType` falls back to `RestrictionType.DEFAULT` (= USER or
   ADMIN) when neither the action nor `settings.auth` sets one. Every
   `DbConnection` service inherits `removeAllEntities` (an unscoped hard
   `DELETE FROM`), so it MUST stay `visibility: 'protected'` (see
   database.mixin.ts) — same reason `users.resolve` is protected. Internal
   `broker.call`/`ctx.call` still reach protected actions.
2. **Scope hooks only run on the verbs you wire them to.** `beforeSelect`
   typically covers `list/find/count/get/all` — NOT `update`/`remove`/
   `resolve`. So the generic `update`/`remove` are unscoped cross-tenant
   writes/deletes unless you set them `auth: ADMIN` or add a `before`
   guard (e.g. `tenantUsers.beforeRemove` checks OWNER/USER_ADMIN + same
   tenant). Internal `ctx.call` bypasses the gateway, so locking the HTTP
   auth never breaks service-to-service flows.

### `$raw` query operator = SQL sink — deep-strip user queries

`@moleculer/database`'s knex adapter executes `query.$raw` as `whereRaw`
**and recurses into every nested object**, so `query[$or][0][id][$raw]`
reaches raw SQL. Top-level-only stripping is bypassable — `sanitizeUserQuery`
(profile.mixin) and `sanitizeQueryForTenantScope` (users.service) must
`stripRawDeep` the user query at every depth. Server-built `$raw` clauses
(parameterized, spread in AFTER sanitization) are unaffected.

### Virtual-field populate gotchas

When a service uses `secure: true` on its primary key (every service in
this repo does for `id`), references to those rows are encoded on the
way out — including in nested `ctx.call('…events.find', {…})` results
*if* you ask for them via `fields: [...]`. Two things follow:

1. **Don't combine `fields: ['<reference>']` with `secure` parents in a
   populate aggregator.** The returned field becomes the encoded string,
   not the raw integer FK, so `Number(r.fishing)` is `NaN` and any
   `Set<number>` lookup silently misses every row.
2. **Prefer a raw SQL query (`this.adapter.knex` or `this.rawQuery`) for
   "does any related row match?" aggregations** — Mongo-DSL through
   moleculer-db, secure ID coding, ProfileMixin scopes, and JSONB
   selectors layer on top of each other in ways that are essentially
   unreviewable.
3. **Always assert the deployed endpoint's response after wiring a
   virtual field.** `tsc --noEmit` and `yarn build` only verify the
   types — they don't catch ID encoding mismatches, missing populate
   path entries, or scope filters that wipe the result. Hit the route
   with `curl | jq` (or DevTools Network) and look at the field
   *before* claiming the populate works.

Real incident (PR #117 follow-up): `Fishing.hasManualLocation` was
implemented with `fields: ['fishing']` in the aggregator → every fishing
came back `false` even though the same events had `locationManual=true`
in `getHistory`. The detail page rendered the warning correctly but the
journal list never did. Switched to raw SQL.

## Patterns when adding code

- New entity: copy a small service (e.g. `polders.service.ts`), wire its
  Knex migration, add to `COMMON_DEFAULT_SCOPES`-aware fields.
- Internal-only action: omit `rest` or set `rest: null` on the action.
- Admin-only HTTP action: `auth: RestrictionType.ADMIN` (or `UserType.ADMIN`
  for top-level service settings auth).
- Errors: use the helpers in `types/constants.ts` —
  `throwUnauthorizedError`, `throwNotFoundError`, `throwNoRightsError`.
  Don't `throw new Error()` — it surfaces as 500 instead of structured
  API errors.
- New JSONB field on existing table: add the column in a migration AND
  list every property in the validator schema (see "validator gotcha").
- New REPL command: append to `replCommands` in `moleculer.config.ts`
  (see the `tenants-import` example) — gives short aliases over `call`.

## Dev workflow

```bash
yarn install
cp .env.example .env             # set DB_CONNECTION, AUTH_HOST, AUTH_API_KEY, …
yarn dc:up                       # docker-compose: postgres + redis
yarn dev                         # migrate + ts-node moleculer-runner --hot --repl
                                 # API on http://localhost:3000/zvejyba/api
                                 # REPL: `mol $`, e.g. `mol $ call fishings.currentFishing`
yarn db:migrate                  # knex migrate:latest manually
yarn test                        # jest (uses DB_CONNECTION)
yarn lint                        # eslint + prettier check
yarn build                       # tsc → dist/
```

REPL custom commands defined in `moleculer.config.ts` `replCommands`
appear without the `call` prefix (e.g. `mol $ tenants-import --dry`).

## Recent fix log (worth knowing)

- **endFishings cron gates on onshore weight** — the midnight `endFishings`
  cron (`0 0 * * *`, Europe/Vilnius) used to close EVERY open fishing
  (`endEvent: { $exists: false }`) unconditionally. Now it only auto-closes
  fishings that already have an onshore weigh-in (a `weight_events` row with
  `tools_group_id IS NULL`); shore-less fishings (incomplete catch reports,
  and skip-only rows) are left open for the fisher to finish. The "has any
  shore weight" set comes from raw SQL (numeric ids), intersected with the
  moleculer `endEvent: { $exists: false }` query via `id: { $in }` — same
  raw-SQL-for-aggregation pattern as `applyLocationFilter` /
  `getManualLocationFlags`. Test: `fishings.spec.ts` → "endFishings closes
  fishings with an onshore weigh-in but leaves shore-less ones open".
- **mass-delete/privesc/SQLi batch** — closed three systemic holes from a
  security audit: (1) `removeAllEntities` → `visibility: 'protected'` so the
  `mappingPolicy: 'all'` fallback URL can't wipe tables; (2) nested `$raw`
  deep-stripped from user queries (profile.mixin + users.service) to kill
  SQL injection via `query[$or][…][$raw]`; (3) `tenantUsers.update` → ADMIN
  and a `beforeRemove` guard (OWNER/USER_ADMIN + same-tenant) so a USER can't
  self-promote or touch another tenant's membership. Tests:
  `security-mass-delete-privesc.spec.ts`. See "Action exposure" + "`$raw`
  query operator" patterns above.
- **cross-tenant IDOR batch** — the default db `update`/`remove` (and
  toolsGroups' `:id` custom actions, which used the unscoped
  `toolsGroups.resolve`) ran no tenant scope, so a USER could edit/delete
  another tenant's rows by id. Added `ProfileMixin.beforeMutate` (mirrors
  `tools.beforeDelete`) and wired it into the mutation verbs of fishings,
  toolsGroups (+ build/connect/disconnect/remove/weigh), tools, weightEvents,
  fishingEvents, toolsGroupsEvents, researches. Also locked `researches.fishes`
  to ADMIN over HTTP (internal-only, no tenant/user column) and pinned
  `researches.listRelated` to `publicFields` (was leaking investigator PII via
  caller-chosen `fields`/`populate`). Tests: `security-cross-tenant-idor.spec.ts`.
  Deferred: unauthenticated Prometheus `/metrics` on :3030 — infra-side (verify
  biip-infra never proxies 3030; binding to localhost risks breaking scraping).
- **PR #117** — `location_manual` boolean on `tools_groups_events` /
  `weight_events` plus virtual `Fishing.hasManualLocation`. First cut
  used `ctx.call('…events.find', { fields: ['fishing'] })` for the
  aggregation and silently miscounted because of the `secure: true` ID
  encoding (see "Virtual-field populate gotchas"). Final version uses a
  raw SQL `UNION` against both event tables.
- **PR #105** — E-vartai juridical login: propagate `{ meta: authToken }`
  to `tenantUsers.create` so director auto-creation actually works.
- **PR #106** — polders feature: new `polders` table + service, fishings
  carry optional `polderId`, `LocationProp` learned `type`, tools-by-
  location filter switched to `buildEvent.fishing.type`.
- **PR #104** — allow ending fishing when preliminary catches are all
  empty.
- **import-tenants** branch — kept locally; one-shot `tenants.importBatch`
  action with seed data of 39 companies.

## Known risks

### GPS coordinates are *not* certified legal evidence

The mobile FE relies on `navigator.geolocation` (W3C). The browser
delegates to the OS, which fuses (1) the device GNSS chip, (2) WiFi
MAC triangulation, and (3) cell-tower lookup. None of these are
certified to forensic-grade accuracy.

Field reports (fishing 297, 298, 301) showed events clustered tens of
kilometers away from the picked Kuršių marios bar — the phone was
genuinely there (at the angler's home / dock); the position field is
honest but lying about where the fishing happened. A separate failure
mode is the desktop / WiFi case where the ISP gateway IP triangulation
biases everywhere within a city to one block.

Mitigations already in code:

- `biip-zvejyba-web` `GeolocationProvider` rejects fixes with
  `position.coords.accuracy > 100 m` — drops the cell / WiFi shortcut
  and waits for a real GPS fix. (PR #148)
- `tools_groups_events` / `weight_events` carry `location_manual: true`
  for user-typed WGS coords; admin journal warns on those rows.

What's still missing for legal-evidence use:

- We do not persist `position.coords.accuracy` alongside `geom` — the
  admin journal cannot show a confidence circle.
- No geofence check that the event coord is plausibly inside the
  picked bar / polder / water body polygon — angler can still record
  a "Patikrinta" from home.
- A truly attested location requires a native mobile app with
  hardware-backed GPS attestation (Android 13+ Play Integrity, iOS
  15+ Core Location integrity check) or an external certified GPS
  receiver. The browser stack does not provide that.

For now treat the journal as **operational evidence** (good faith
record of what the user reported) rather than **forensic evidence**
(prosecutable proof of presence). When legal cases come up, this
limitation should be on the table early.

## Conventions

- Conventional Commits (`feat:`, `fix:`, `chore:`); merges through PRs,
  no squash. Recent merges have descriptive subjects, useful for `git log`.
- Snake_case migration filenames, snake_case columns, camelCase service
  files (`tenantUsers.service.ts`).
- Imports auto-organized by `prettier-plugin-organize-imports`. Lint
  config: `@aplinkosministerija/eslint-config-biip-api`.
- Branches: kebab-case (`feat/polderiai`, `fix-end-fishing-empty-weights`).
- Don't add comments that just restate what code does — leave only the
  *why* (constraints, prior incidents, hidden invariants).
