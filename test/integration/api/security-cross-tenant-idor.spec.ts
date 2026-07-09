'use strict';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ServiceBroker } from 'moleculer';
import request from 'supertest';
import { ApiHelper, FixtureTenant, FixtureUser, serviceBrokerConfig } from '../../helpers/api';

// P1 batch: the generic db `update`/`remove` (and toolsGroups' `:id` custom
// mutations) ran no tenant scope, so a USER could edit/delete another tenant's
// rows by id. `ProfileMixin.beforeMutate` now pins every id-based mutation to
// the caller's tenant/user. Also: `researches.fishes` is locked to ADMIN over
// HTTP, and `researches.listRelated` no longer leaks PII via caller-chosen
// `fields`/`populate`.

const broker = new ServiceBroker(serviceBrokerConfig);
const apiHelper = new ApiHelper(broker);
const apiService = apiHelper.initializeServices();

let seq = 0;

// Mirrors the valid shape in researches.spec.ts (numeric indices are required).
const baseResearch = {
  waterBodyData: { name: 'Lake', area: 10 },
  predatoryFishesRelativeAbundance: 0.5,
  predatoryFishesRelativeBiomass: 0.5,
  averageWeight: 0.3,
  valuableFishesRelativeBiomass: 0.4,
  conditionIndex: 0.6,
};

async function newTool(owner: FixtureUser, tenant: FixtureTenant): Promise<any> {
  const types: any[] = await broker.call('toolTypes.find');
  const sealNr = `S-idor-${seq++}`;
  const meta = apiHelper.meta(owner, tenant.tenant.id);
  await broker.call(
    'tools.create',
    { sealNr, toolType: types[0].id, data: { eyeSize: 60, netLength: 30 } },
    { meta },
  );
  return broker.call('tools.findOne', { query: { sealNr } }, { meta });
}

beforeAll(async () => {
  await broker.start();
  await apiHelper.setup();
});
afterAll(() => broker.stop());

describe('cross-tenant write guard — generic tools.update (beforeMutate)', () => {
  it('OWNER of tenantA CANNOT PATCH another tenant`s tool', async () => {
    const toolB = await newTool(apiHelper.ownerB, apiHelper.tenantB);

    const res = await request(apiService.server)
      .patch(`/zvejyba/api/tools/${toolB.id}`)
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id))
      .send({ data: { eyeSize: 999, netLength: 30 } });
    expect([401, 403]).toContain(res.status);

    // The foreign tool is untouched.
    const after: any = await broker.call(
      'tools.findOne',
      { query: { id: toolB.id } },
      { meta: apiHelper.meta(apiHelper.superAdmin) },
    );
    expect(after.data.eyeSize).toBe(60);
  });

  it('OWNER CAN PATCH a tool in their OWN tenant', async () => {
    const toolA = await newTool(apiHelper.ownerA, apiHelper.tenantA);

    const res = await request(apiService.server)
      .patch(`/zvejyba/api/tools/${toolA.id}`)
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id))
      .send({ data: { eyeSize: 70, netLength: 30 } });
    expect(res.status).toBe(200);
  });
});

describe('cross-tenant delete guard — fishings.remove (beforeMutate)', () => {
  it('USER cannot remove another tenant`s fishing by id', async () => {
    const fishingB: any = await broker.call(
      'fishings.create',
      {
        type: 'INLAND_WATERS',
        tenant: apiHelper.tenantB.tenant.id,
        user: apiHelper.ownerB.user.id,
      },
      { meta: { authToken: apiHelper.superAdmin.token } },
    );

    const res = await request(apiService.server)
      .post('/zvejyba/api/fishings/remove')
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id))
      .send({ id: fishingB.id });
    expect([401, 403]).toContain(res.status);

    // Still there.
    const after: any = await broker.call(
      'fishings.get',
      { id: fishingB.id },
      { meta: apiHelper.meta(apiHelper.superAdmin) },
    );
    expect(after.id).toBe(fishingB.id);
  });
});

describe('researches.fishes is not USER-reachable over HTTP', () => {
  it('USER cannot reach researches.fishes.find via the fallback URL', async () => {
    const res = await request(apiService.server)
      .post('/zvejyba/api/researches.fishes/find')
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id))
      .send({});
    expect([401, 403, 404]).toContain(res.status);
  });

  it('internal broker.call still works (research management path)', async () => {
    const rows: any = await broker.call(
      'researches.fishes.find',
      {},
      { meta: apiHelper.meta(apiHelper.superAdmin) },
    );
    expect(Array.isArray(rows)).toBe(true);
  });
});

describe('researches.listRelated does not leak PII via caller-chosen fields', () => {
  it('ignores ?fields=user,tenant&populate=user — only public fields returned', async () => {
    const a: any = await broker.call(
      'researches.create',
      { ...baseResearch, cadastralId: '00079001', startAt: '2024-01-01', endAt: '2024-01-10' },
      { meta: apiHelper.meta(apiHelper.superAdmin) },
    );
    await broker.call(
      'researches.create',
      { ...baseResearch, cadastralId: '00079001', startAt: '2025-01-01', endAt: '2025-01-10' },
      { meta: apiHelper.meta(apiHelper.superAdmin) },
    );

    const res = await request(apiService.server)
      .get(`/zvejyba/api/public/researches/${a.id}/related`)
      .query({ fields: 'id,user,tenant', populate: 'user' })
      .expect(200);

    expect(res.body.total).toBeGreaterThanOrEqual(1);
    for (const row of res.body.rows) {
      expect(row).not.toHaveProperty('user');
      expect(row).not.toHaveProperty('tenant');
    }
  });
});
