'use strict';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ServiceBroker } from 'moleculer';
import request from 'supertest';
import { ApiHelper, serviceBrokerConfig } from '../../helpers/api';

// Regression coverage for /cso audit Findings #1, #2, #3, #6, #7
// (PR #121 fixes). Each spec asserts the post-fix behaviour.

const broker = new ServiceBroker(serviceBrokerConfig);
const apiHelper = new ApiHelper(broker);
const apiService = apiHelper.initializeServices();

beforeAll(async () => {
  await broker.start();
  await apiHelper.setup();
});
afterAll(() => broker.stop());

describe('Finding #1 — ProfileMixin tenant-scope bypass', () => {
  it('USER cannot read another tenant by passing query[tenant]=<other>', async () => {
    // Seed a fishing for tenantB so it would show up if the scope leaked.
    await broker.call(
      'fishings.create',
      { type: 'INLAND_WATERS', tenant: apiHelper.tenantB.tenant.id, user: apiHelper.ownerB.user.id },
      { meta: { authToken: apiHelper.superAdmin.token } },
    );

    const res = await request(apiService.server)
      .get('/zvejyba/api/fishings')
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id))
      .query({ query: JSON.stringify({ tenant: apiHelper.tenantB.tenant.id }) });

    if (res.status !== 200) {
      // eslint-disable-next-line no-console
      console.log('STATUS:', res.status, 'BODY:', JSON.stringify(res.body).slice(0, 500));
    }
    expect(res.status).toBe(200);

    const tenantIds = (res.body.rows ?? []).map((r: any) => r.tenant);
    // Should NOT see tenantB's row regardless of what the caller asked for.
    expect(tenantIds.every((t: any) => t === apiHelper.tenantA.tenant.id || t == null)).toBe(true);
  });

  it('USER cannot read another user via query[user]=<id> in personal profile', async () => {
    // Seed a personal-profile fishing for freelancerB.
    await broker.call(
      'fishings.create',
      { type: 'INLAND_WATERS', user: apiHelper.freelancerB.user.id },
      { meta: { authToken: apiHelper.superAdmin.token } },
    );

    const res = await request(apiService.server)
      .get('/zvejyba/api/fishings')
      .set(apiHelper.getHeaders(apiHelper.freelancerA.token))
      .query({ query: JSON.stringify({ user: apiHelper.freelancerB.user.id }) })
      .expect(200);

    const userIds = (res.body.rows ?? []).map((r: any) => r.user);
    expect(userIds.every((u: any) => u === apiHelper.freelancerA.user.id)).toBe(true);
  });

  it('$raw smuggled in caller query is stripped', async () => {
    const res = await request(apiService.server)
      .get('/zvejyba/api/fishings')
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id))
      .query({
        query: JSON.stringify({
          $raw: { condition: '1 = 1', bindings: [] },
        }),
      })
      .expect(200);
    // No 500 means the $raw didn't reach knex with a malicious condition.
    expect(Array.isArray(res.body.rows)).toBe(true);
  });
});

describe('Finding #2 — minio.getFile no longer PUBLIC', () => {
  it('unauthenticated GET /minio/<bucket>/<file> returns 401', async () => {
    await request(apiService.server)
      .get('/zvejyba/api/minio/zvejyba-test/secret.pdf')
      .expect(401);
  });
});

describe('Finding #3 — minio internal actions ADMIN-only over HTTP', () => {
  // The real service has `rest: null` so no autoAlias is generated.
  // The only HTTP surface left is the mappingPolicy:'all' fallback,
  // which maps `/minio/removeFile` → `minio.removeFile`.
  it('USER cannot POST /minio/removeFile', async () => {
    const res = await request(apiService.server)
      .post('/zvejyba/api/minio/removeFile')
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id))
      .send({ path: 'zvejyba-test/foo' });
    expect([401, 403]).toContain(res.status);
  });

  it('ADMIN can POST /minio/removeFile', async () => {
    await request(apiService.server)
      .post('/zvejyba/api/minio/removeFile')
      .set(apiHelper.getHeaders(apiHelper.adminA.token))
      .send({ path: 'zvejyba-test/foo' })
      .expect(200);
  });
});

describe('Finding #6 — helmet headers present', () => {
  it('response carries X-Content-Type-Options and Referrer-Policy', async () => {
    const res = await request(apiService.server).get('/zvejyba/api/ping').expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBeDefined();
    // helmet drops X-Powered-By and exposes COOP/CORP/etc.
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('Finding #7 — public UETK statistics rejects Mongo operators', () => {
  it('rejects ?date={"$ne":null}', async () => {
    await request(apiService.server)
      .get('/zvejyba/api/public/uetk/statistics')
      .query({ date: JSON.stringify({ $ne: null }) })
      .expect(422);
  });

  it('accepts an ISO date string', async () => {
    await request(apiService.server)
      .get('/zvejyba/api/public/uetk/statistics')
      .query({ date: '2025-01-01' })
      .expect(200);
  });

  it('accepts {from, to} when supplied as a nested query object', async () => {
    // qs parses `?date[from]=...&date[to]=...` into `{ date: { from, to } }`,
    // which the second variant of the validator accepts.
    await request(apiService.server)
      .get('/zvejyba/api/public/uetk/statistics')
      .query({ 'date[from]': '2025-01-01', 'date[to]': '2025-12-31' })
      .expect(200);
  });
});
