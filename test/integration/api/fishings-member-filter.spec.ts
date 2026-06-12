'use strict';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ServiceBroker } from 'moleculer';
import request from 'supertest';
import { ApiHelper, serviceBrokerConfig } from '../../helpers/api';

// A company (tenant-profile) member may narrow the already tenant-scoped
// fishing journal to one colleague (`?query={"user":<id>}`). ProfileMixin
// normally strips `user` from caller queries; fishings re-applies it for
// tenant profiles only, as a bare scalar, with `tenant: profile` still
// enforced. These specs pin the allowed behaviour AND the security envelope:
// it can never cross tenants and an object/operator value is ignored.
const broker = new ServiceBroker(serviceBrokerConfig);
const apiHelper = new ApiHelper(broker);
const apiService = apiHelper.initializeServices();

let userAFishingId: any;
let ownerAFishingId: any;
let ownerBFishingId: any;

beforeAll(async () => {
  await broker.start();
  await apiHelper.setup();

  const adminMeta = { authToken: apiHelper.superAdmin.token };
  const userAFishing: any = await broker.call(
    'fishings.create',
    { type: 'INLAND_WATERS', tenant: apiHelper.tenantA.tenant.id, user: apiHelper.userA.user.id },
    { meta: adminMeta },
  );
  userAFishingId = userAFishing.id;
  const ownerAFishing: any = await broker.call(
    'fishings.create',
    { type: 'INLAND_WATERS', tenant: apiHelper.tenantA.tenant.id, user: apiHelper.ownerA.user.id },
    { meta: adminMeta },
  );
  ownerAFishingId = ownerAFishing.id;
  const ownerBFishing: any = await broker.call(
    'fishings.create',
    { type: 'INLAND_WATERS', tenant: apiHelper.tenantB.tenant.id, user: apiHelper.ownerB.user.id },
    { meta: adminMeta },
  );
  ownerBFishingId = ownerBFishing.id;
});
afterAll(() => broker.stop());

const idsOf = (res: any) => (res.body.rows ?? []).map((r: any) => r.id);

describe('fishings journal — company member filter', () => {
  it('a tenant member can narrow the journal to a colleague', async () => {
    const res = await request(apiService.server)
      .get('/zvejyba/api/fishings')
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id))
      .query({ query: JSON.stringify({ user: apiHelper.userA.user.id }) })
      .expect(200);

    const ids = idsOf(res);
    expect(ids).toContain(userAFishingId); // colleague's fishing shows
    expect(ids).not.toContain(ownerAFishingId); // own fishing filtered out
    expect(ids).not.toContain(ownerBFishingId); // never another tenant
  });

  it('the member filter can never cross tenants', async () => {
    const res = await request(apiService.server)
      .get('/zvejyba/api/fishings')
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id))
      .query({ query: JSON.stringify({ user: apiHelper.ownerB.user.id }) })
      .expect(200);

    // tenantB's user has no tenantA fishings → empty, and tenantB row never leaks.
    expect(idsOf(res)).not.toContain(ownerBFishingId);
  });

  it('an object/operator user value is ignored (no injection, stays tenant-scoped)', async () => {
    const res = await request(apiService.server)
      .get('/zvejyba/api/fishings')
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id))
      .query({ query: JSON.stringify({ user: { $ne: apiHelper.ownerA.user.id } }) })
      .expect(200);

    const ids = idsOf(res);
    // Object rejected → no member narrowing → the whole tenantA journal,
    // and crucially NO tenantB leak.
    expect(ids).toContain(userAFishingId);
    expect(ids).toContain(ownerAFishingId);
    expect(ids).not.toContain(ownerBFishingId);
  });

  it('a personal-profile user still cannot filter by another user (unchanged)', async () => {
    const res = await request(apiService.server)
      .get('/zvejyba/api/fishings')
      .set(apiHelper.getHeaders(apiHelper.freelancerA.token))
      .query({ query: JSON.stringify({ user: apiHelper.userA.user.id }) })
      .expect(200);

    // Personal profile is forced to self → cannot see the tenant member's row.
    expect(idsOf(res)).not.toContain(userAFishingId);
  });

  it('an admin can still filter fishings by any user', async () => {
    const res = await request(apiService.server)
      .get('/zvejyba/api/fishings')
      .set(apiHelper.getHeaders(apiHelper.superAdmin.token))
      .query({ query: JSON.stringify({ user: apiHelper.ownerB.user.id }) })
      .expect(200);

    const ids = idsOf(res);
    expect(ids).toContain(ownerBFishingId);
    expect(ids).not.toContain(userAFishingId);
  });
});
