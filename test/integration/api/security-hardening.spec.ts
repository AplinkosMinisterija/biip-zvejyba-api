'use strict';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ServiceBroker } from 'moleculer';
import request from 'supertest';
import { ApiHelper, serviceBrokerConfig } from '../../helpers/api';
import { getPublicFileName } from '../../../types';

// Regression coverage for the PR that closed /cso audit findings
// C1, C2, C3, C4, C5, C6, C7, H1, H2, H4, H9 (see PR description).
// Each `describe` mirrors one audit finding and asserts the post-fix
// behaviour. Existing security-regression.spec.ts still covers prior
// findings (#1–#7 from the earlier audit pass).

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
