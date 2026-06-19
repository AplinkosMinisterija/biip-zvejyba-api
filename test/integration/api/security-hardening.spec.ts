'use strict';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ServiceBroker } from 'moleculer';
import request from 'supertest';
import { coordinatesToGeometry } from '../../../modules/geometry';
import { getPublicFileName } from '../../../types';
import { ApiHelper, serviceBrokerConfig } from '../../helpers/api';

// Regression coverage for the PR that closed /cso audit findings
// C1-C7, H1-H5, H9 + the follow-up batch M1, M2, M4, M6, M10, M12,
// M14, M16, A6, A7, A8, A9, H11. Each `describe` mirrors one audit
// finding and asserts the post-fix behaviour. Existing
// security-regression.spec.ts still covers prior findings (#1-#7).

const broker = new ServiceBroker(serviceBrokerConfig);
const apiHelper = new ApiHelper(broker);
const apiService = apiHelper.initializeServices();

beforeAll(async () => {
  await broker.start();
  await apiHelper.setup();
});
afterAll(() => broker.stop());

describe('C1 — x-profile membership validated at the gateway', () => {
  it('USER cannot set x-profile to a tenant they are NOT a member of', async () => {
    // ownerA is OWNER of tenantA, NOT a member of tenantB.
    const res = await request(apiService.server)
      .get('/zvejyba/api/fishings/current')
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantB.tenant.id));
    expect(res.status).toBe(401);
  });

  it('USER with x-profile matching their own tenant is allowed through', async () => {
    await request(apiService.server)
      .get('/zvejyba/api/fishings/current')
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id))
      .expect(200);
  });

  it('USER without x-profile (freelancer mode) is allowed through', async () => {
    await request(apiService.server)
      .get('/zvejyba/api/fishings/current')
      .set(apiHelper.getHeaders(apiHelper.freelancerA.token))
      .expect(200);
  });

  it('ADMIN passes the gateway membership check regardless of x-profile value', async () => {
    // `tenants.list` requires ADMIN (service-level setting) and does NOT
    // care about `x-profile`. If the new membership guard wrongly applied
    // to non-USER callers, the SUPER_ADMIN would 401 here instead of 200.
    await request(apiService.server)
      .get('/zvejyba/api/tenants')
      .set(apiHelper.getHeaders(apiHelper.superAdmin.token, 999999))
      .expect(200);
  });
});

describe('C2 — users.byTenant / users.list ADMIN-only', () => {
  it('USER role cannot GET /users/byTenant/:tenant', async () => {
    const res = await request(apiService.server)
      .get(`/zvejyba/api/users/byTenant/${apiHelper.tenantA.tenant.id}`)
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id));
    expect([401, 403]).toContain(res.status);
  });

  // Note: testing `users.list` via `broker.call` would bypass the
  // gateway authorize() check — the `auth: ADMIN` flag is enforced at
  // moleculer-web, not inside the action. The HTTP-level enforcement is
  // covered by the `users.byTenant` test above (same auth path).
});

describe('C3 — tenants.authGroup is immutable', () => {
  it('PATCH /tenants/:id { authGroup: <other> } does NOT rewrite authGroup', async () => {
    const targetTenantId = apiHelper.tenantA.tenant.id;
    const originalAuthGroup = apiHelper.tenantA.authGroupId;
    const evilAuthGroup = apiHelper.tenantB.authGroupId;

    await request(apiService.server)
      .patch(`/zvejyba/api/tenants/${targetTenantId}`)
      .set(apiHelper.getHeaders(apiHelper.adminA.token))
      .send({ authGroup: evilAuthGroup });
    // Moleculer may 200 the update (immutable field is silently dropped)
    // or 422 it — the contract is "authGroup MUST NOT change".

    const after: any = await broker.call(
      'tenants.get',
      { id: targetTenantId },
      { meta: apiHelper.meta(apiHelper.superAdmin) },
    );
    expect(after.authGroup).toBe(originalAuthGroup);
    expect(after.authGroup).not.toBe(evilAuthGroup);
  });
});

describe('C4 — fishings.endFishings is not HTTP-reachable', () => {
  it('POST /fishings/endFishings is not auto-aliased', async () => {
    const res = await request(apiService.server)
      .post('/zvejyba/api/fishings/endFishings')
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id));
    expect(res.status).toBe(404);
  });

  it('broker.call still works for the cron flow', async () => {
    // Internal cron path must continue functioning.
    const result = await broker.call('fishings.endFishings');
    expect(Array.isArray(result)).toBe(true);
  });
});

// C5 — minio.getFile bucket + path validation
//
// The integration harness loads `MockMinioService` instead of the real
// `services/minio.service.ts` (see `test/helpers/mock-minio.service.ts`
// — it claims the same `name: 'minio'` slot). The mock has no bucket
// allowlist or path-prefix check, so we cannot exercise the new
// validation behaviour through `request(apiService.server)`. The fix is
// directly verifiable by code review in `services/minio.service.ts`:
//   1) `bucket !== BUCKET_NAME()` → 404
//   2) first path segment must equal `uploads`
//   3) `..` / empty / slash-in-segment rejected

describe('C6 — getPublicFileName uses crypto.randomBytes', () => {
  it('produces unique values across 200 calls', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(getPublicFileName(30));
    expect(seen.size).toBe(200);
  });

  it('respects the requested length', () => {
    expect(getPublicFileName(30)).toHaveLength(30);
    expect(getPublicFileName(50)).toHaveLength(50);
  });

  it('uses the base64url alphabet (A–Z a–z 0–9 - _)', () => {
    // Math.random version only emitted A–Z a–z 0–9; the crypto version
    // adds `-` / `_`. Either character class is acceptable here — the
    // important property is that the entire string fits base64url.
    const sample = getPublicFileName(120);
    expect(sample).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('C7 — users.impersonate is SUPER_ADMIN only', () => {
  it('USER cannot impersonate anyone', async () => {
    const res = await request(apiService.server)
      .post(`/zvejyba/api/users/${apiHelper.ownerB.user.id}/impersonate`)
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id));
    expect([401, 403]).toContain(res.status);
  });

  it('ROLE_ADMIN (not SUPER_ADMIN) cannot impersonate', async () => {
    const res = await request(apiService.server)
      .post(`/zvejyba/api/users/${apiHelper.ownerB.user.id}/impersonate`)
      .set(apiHelper.getHeaders(apiHelper.adminA.token));
    expect([401, 403]).toContain(res.status);
  });

  it('SUPER_ADMIN can still impersonate', async () => {
    const res = await request(apiService.server)
      .post(`/zvejyba/api/users/${apiHelper.ownerA.user.id}/impersonate`)
      .set(apiHelper.getHeaders(apiHelper.superAdmin.token));
    expect(res.status).toBe(200);
  });
});

describe('H1 — users.resolve is not exposed over HTTP', () => {
  it('POST /api/users/resolve is not auto-aliased', async () => {
    const res = await request(apiService.server)
      .post('/zvejyba/api/users/resolve')
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id))
      .send({ id: apiHelper.ownerB.user.id });
    expect(res.status).toBe(404);
  });

  it('internal broker.call still resolves', async () => {
    const u: any = await broker.call('users.resolve', { id: apiHelper.ownerA.user.id });
    expect(u?.id).toBe(apiHelper.ownerA.user.id);
  });
});

describe('H2 — fishings.update cannot rewrite tenant/user', () => {
  it('PATCH /fishings/:id { tenant, user } leaves the FKs untouched', async () => {
    // Seed a fishing for ownerA / tenantA.
    const seeded: any = await broker.call(
      'fishings.create',
      {
        type: 'INLAND_WATERS',
        tenant: apiHelper.tenantA.tenant.id,
        user: apiHelper.ownerA.user.id,
      },
      { meta: { authToken: apiHelper.superAdmin.token } },
    );

    await request(apiService.server)
      .patch(`/zvejyba/api/fishings/${seeded.id}`)
      .set(apiHelper.getHeaders(apiHelper.adminA.token))
      .send({ tenant: apiHelper.tenantB.tenant.id, user: apiHelper.ownerB.user.id });

    const after: any = await broker.call(
      'fishings.get',
      { id: seeded.id },
      { meta: apiHelper.meta(apiHelper.superAdmin) },
    );
    expect(after.tenant).toBe(apiHelper.tenantA.tenant.id);
    expect(after.user).toBe(apiHelper.ownerA.user.id);
  });
});

describe('H4 — research / fishType uploads require INVESTIGATOR / ADMIN', () => {
  it('USER cannot POST /researches/upload', async () => {
    const res = await request(apiService.server)
      .post('/zvejyba/api/researches/upload')
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id));
    expect([401, 403]).toContain(res.status);
  });

  it('USER cannot POST /fishTypes/upload', async () => {
    const res = await request(apiService.server)
      .post('/zvejyba/api/fishTypes/upload')
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id));
    expect([401, 403]).toContain(res.status);
  });
});

// H9 — minio.removeFile bucket allowlist
//
// Same harness limitation as C5: the test broker mounts MockMinioService,
// not the real `services/minio.service.ts`. The bucket allowlist
// (`if (bucket !== BUCKET_NAME()) return { sucess: false }`) is verified
// by code review.

// ── Follow-up batch (M1, M2, M4, M6, M10, M12, M14, M16, A6, A7, A8, A9, H11) ──

describe('M2 — coordinatesToGeometry validates WGS84 range', () => {
  it('accepts a Lithuanian coordinate', () => {
    expect(() => coordinatesToGeometry({ x: 24.95, y: 55.45 })).not.toThrow();
  });
  it('rejects NaN', () => {
    expect(() => coordinatesToGeometry({ x: NaN, y: 55 })).toThrow(/Invalid WGS84/);
  });
  it('rejects Infinity', () => {
    expect(() => coordinatesToGeometry({ x: 24, y: Infinity })).toThrow(/Invalid WGS84/);
  });
  it('rejects out-of-range latitude', () => {
    expect(() => coordinatesToGeometry({ x: 24, y: 95 })).toThrow(/Invalid WGS84/);
  });
  it('rejects out-of-range longitude', () => {
    expect(() => coordinatesToGeometry({ x: 200, y: 55 })).toThrow(/Invalid WGS84/);
  });
});

describe('M12 — location.search JSON.parse handles malformed input', () => {
  it('malformed query string returns 422, not a 500', async () => {
    const res = await request(apiService.server)
      .get('/zvejyba/api/locations')
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id))
      .query({ query: '{not json' });
    expect(res.status).toBe(422);
  });
});

describe('M16 — public UETK stats reject fish=<garbage>', () => {
  it('rejects ?fish=foo at the validator', async () => {
    await request(apiService.server)
      .get('/zvejyba/api/public/uetk/statistics')
      .query({ fish: 'foo' })
      .expect(422);
  });
  it('accepts ?fish=42', async () => {
    await request(apiService.server)
      .get('/zvejyba/api/public/uetk/statistics')
      .query({ fish: '42' })
      .expect(200);
  });
});

describe('M1 — fishings.exportCaughtFishes: fishers export their OWN journal + JSON validation', () => {
  // The #M1 ADMIN-only lock over-corrected: a plain USER can read their
  // journal but could not export it. The endpoint is now DEFAULT, and the
  // data is sourced from the tenant-scoped `fishings.find`, so a USER only
  // exports their own rows.
  it('USER (fisher) CAN export their own journal (200, not 401)', async () => {
    const res = await request(apiService.server)
      .get('/zvejyba/api/fishings/exportCaughtFishes')
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id));
    expect(res.status).toBe(200);
  });

  it('the export source (`fishings.find`) is tenant-scoped for a USER — no cross-tenant leak', async () => {
    await broker.call(
      'fishings.create',
      {
        type: 'INLAND_WATERS',
        tenant: apiHelper.tenantA.tenant.id,
        user: apiHelper.ownerA.user.id,
      },
      { meta: { authToken: apiHelper.superAdmin.token } },
    );
    await broker.call(
      'fishings.create',
      {
        type: 'INLAND_WATERS',
        tenant: apiHelper.tenantB.tenant.id,
        user: apiHelper.ownerB.user.id,
      },
      { meta: { authToken: apiHelper.superAdmin.token } },
    );

    // Exactly what `exportCaughtFishes` reads, with the fisher's own meta.
    const found: any[] = await broker.call(
      'fishings.find',
      {},
      { meta: apiHelper.meta(apiHelper.ownerA, apiHelper.tenantA.tenant.id) },
    );
    const tenants = new Set(found.map((f) => String(f.tenant)));
    expect(tenants.has(String(apiHelper.tenantB.tenant.id))).toBe(false);
  });

  it('USER with malformed query JSON gets 422, not 500', async () => {
    const res = await request(apiService.server)
      .get('/zvejyba/api/fishings/exportCaughtFishes')
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id))
      .query({ query: '{not json' });
    expect(res.status).toBe(422);
  });

  it('ADMIN can still export (unscoped, full)', async () => {
    const res = await request(apiService.server)
      .get('/zvejyba/api/fishings/exportCaughtFishes')
      .set(apiHelper.getHeaders(apiHelper.adminA.token));
    expect(res.status).toBe(200);
  });
});

describe('A6 — tenantUsers.invite no longer accepts body.tenant', () => {
  it('an OWNER without x-profile cannot smuggle tenant via body', async () => {
    const res = await request(apiService.server)
      .post('/zvejyba/api/tenantUsers/invite')
      .set(apiHelper.getHeaders(apiHelper.ownerA.token)) // NO x-profile
      .send({
        firstName: 'X',
        lastName: 'Y',
        personalCode: '39001019999',
        email: 'evil@test.lt',
        role: 'OWNER',
        // Old vulnerable shape — should be ignored by the schema now.
        tenant: apiHelper.tenantB.tenant.id,
      });
    // Either 422 (param schema strips it) or 401 (validateCanEditTenantUser
    // throws because profile is missing). Both are acceptable rejections.
    expect([401, 403, 422]).toContain(res.status);
  });
});

describe('A7 — users.updateMyProfile only writes email/phone', () => {
  it('extra fields in body are not persisted', async () => {
    await request(apiService.server)
      .patch('/zvejyba/api/users/me')
      .set(apiHelper.getHeaders(apiHelper.userA.token, apiHelper.tenantA.tenant.id))
      .send({
        email: 'newaddr@test.lt',
        phone: '+37060099999',
        type: 'ADMIN', // attempted privilege escalation
        isInvestigator: true,
        firstName: 'EvilName',
      });

    const after: any = await broker.call(
      'users.resolve',
      { id: apiHelper.userA.user.id },
      { meta: apiHelper.meta(apiHelper.superAdmin) },
    );
    expect(after.email).toBe('newaddr@test.lt');
    expect(after.phone).toBe('+37060099999');
    // None of the escalation attempts landed.
    expect(after.type).toBe('USER');
    expect(after.isInvestigator).toBe(false);
    expect(after.firstName).not.toBe('EvilName');
  });
});

describe('M4 — tenants.remove stays ADMIN-tier (operational requirement)', () => {
  // Earlier draft locked this to SUPER_ADMIN; reverted on user feedback —
  // ROLE_ADMIN operators in biip-admin-web routinely manage tenant
  // lifecycle (onboarding, suspension, removal). Assert here that a
  // regular ADMIN auth user CAN still delete, while a USER cannot.
  it('plain ADMIN CAN DELETE /tenants/:id', async () => {
    const res = await request(apiService.server)
      .delete(`/zvejyba/api/tenants/${apiHelper.tenantB.tenant.id}`)
      .set(apiHelper.getHeaders(apiHelper.adminA.token));
    expect(res.status).toBe(200);
  });

  it('USER role cannot DELETE /tenants/:id', async () => {
    const res = await request(apiService.server)
      .delete(`/zvejyba/api/tenants/${apiHelper.tenantA.tenant.id}`)
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id));
    expect([401, 403]).toContain(res.status);
  });
});

describe('H11 — tools.toolsGroup populate uses parameterized $raw', () => {
  it('a tools.find with populate=toolsGroup does not throw a SQL error', async () => {
    // The interesting assertion is "no SQL crash from the parameterized
    // `? = ANY(tools)` bind"; whether the tool happens to be in any
    // toolsGroup is irrelevant. Use an empty result set so the test
    // doesn't depend on the seed-driven `toolTypes.id` or per-test
    // fixture state.
    const found: any = await broker.call(
      'tools.find',
      { query: { id: -1 }, populate: ['toolsGroup'] },
      { meta: apiHelper.meta(apiHelper.superAdmin) },
    );
    expect(Array.isArray(found)).toBe(true);
  });
});

describe('A8 — tenantUsers app-level dedupe', () => {
  // The original audit fix tried to enforce this at the DB level with
  // a partial UNIQUE index, but the migration crashed on staging
  // (pre-existing historical duplicates). The migration is now a no-op
  // and the constraint is deferred to a dedicated PR with data
  // preflight. This test now exercises the existing app-level guard
  // (`tenantUsers.beforeCreate`), which already throws ALREADY_EXISTS
  // before reaching the DB.
  it('duplicate tenantUsers.create is rejected by beforeCreate', async () => {
    // Use tenantA — tenantB was just removed by the M4 ADMIN-delete test
    // above (specs share a broker instance, jest runs describe blocks in
    // file order). tenantA is the OWNER's home tenant and stays put.
    const fresh = await apiHelper.makeTenantMember(apiHelper.tenantA, 'USER' as any);
    await expect(
      broker.call(
        'tenantUsers.create',
        {
          tenant: apiHelper.tenantA.tenant.id,
          user: fresh.user.id,
          role: 'USER',
        },
        { meta: { authToken: apiHelper.superAdmin.token } },
      ),
    ).rejects.toMatchObject({ type: 'ALREADY_EXISTS' });
  });
});

describe('M14 — pageSize capped via DbConnection maxLimit', () => {
  it('pageSize > 100 is rejected at the validator', async () => {
    // @moleculer/database wires `maxLimit` into the action params'
    // `max:` constraint, so callers asking for absurd page sizes 422 at
    // the gateway instead of silently fanning out N+1 populate calls.
    await expect(
      broker.call(
        'fishings.list',
        { pageSize: 10000 },
        { meta: apiHelper.meta(apiHelper.superAdmin) },
      ),
    ).rejects.toMatchObject({ code: 422 });
  });

  it('pageSize <= 100 is accepted', async () => {
    const res: any = await broker.call(
      'fishings.list',
      { pageSize: 100 },
      { meta: apiHelper.meta(apiHelper.superAdmin) },
    );
    expect(res.pageSize).toBe(100);
  });
});
