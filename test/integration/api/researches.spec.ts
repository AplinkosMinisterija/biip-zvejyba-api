'use strict';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ServiceBroker } from 'moleculer';
import request from 'supertest';
import { MockAuthState } from '../../helpers/mock-auth.service';
import { ApiHelper, serviceBrokerConfig } from '../../helpers/api';

const broker = new ServiceBroker(serviceBrokerConfig);
const apiHelper = new ApiHelper(broker);
const apiService = apiHelper.initializeServices();

let investigator: any;

beforeAll(async () => {
  await broker.start();
  await apiHelper.setup();

  // Build an investigator user — local mirror + INVESTIGATOR permission on
  // the auth side so the API gateway lets them through researches.createOrUpdate.
  investigator = await apiHelper.makeAuthUser();
  MockAuthState.setPermissions(investigator.authUser.id, {
    FISHING: { accesses: ['INVESTIGATOR'] },
  });
});
afterAll(() => broker.stop());

// `geom` intentionally omitted — `handleMunicipality` hook calls
// `locations.findMunicipality` which doesn't exist on the locations
// service today (legacy code path). Tests cover the rest of the surface.
const baseResearch = {
  cadastralId: '00070001',
  waterBodyData: { name: 'Test Lake', area: 100 },
  startAt: '2025-05-01',
  endAt: '2025-05-10',
  predatoryFishesRelativeAbundance: 0.5,
  predatoryFishesRelativeBiomass: 0.5,
  averageWeight: 0.3,
  valuableFishesRelativeBiomass: 0.4,
  conditionIndex: 0.6,
};

describe('researches.service', () => {
  it('GET /public/researches lists researches (PUBLIC)', async () => {
    // Seed one research first as super admin so the public list has data.
    await broker.call(
      'researches.create',
      { ...baseResearch },
      { meta: apiHelper.meta(apiHelper.superAdmin) },
    );

    const res = await request(apiService.server)
      .get('/zvejyba/api/public/researches')
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('GET /public/researches/:id returns a single research (PUBLIC)', async () => {
    const created: any = await broker.call(
      'researches.create',
      { ...baseResearch, cadastralId: '00070002' },
      { meta: apiHelper.meta(apiHelper.superAdmin) },
    );

    const res = await request(apiService.server)
      .get(`/zvejyba/api/public/researches/${created.id}`)
      .expect(200);
    expect(res.body.cadastralId).toBe('00070002');
  });

  it('GET /public/researches/:id/related returns same-cadastralId researches', async () => {
    const a: any = await broker.call(
      'researches.create',
      { ...baseResearch, cadastralId: '00070003', startAt: '2024-01-01', endAt: '2024-01-10' },
      { meta: apiHelper.meta(apiHelper.superAdmin) },
    );
    await broker.call(
      'researches.create',
      { ...baseResearch, cadastralId: '00070003', startAt: '2025-01-01', endAt: '2025-01-10' },
      { meta: apiHelper.meta(apiHelper.superAdmin) },
    );

    const res = await request(apiService.server)
      .get(`/zvejyba/api/public/researches/${a.id}/related`)
      .expect(200);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
  });

  it('USER (non-investigator) cannot POST /researches (INVESTIGATOR only)', async () => {
    const res = await request(apiService.server)
      .post('/zvejyba/api/researches')
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id))
      .send({ ...baseResearch });
    expect([401, 403]).toContain(res.status);
  });

  it('INVESTIGATOR can POST /researches with fishes', async () => {
    const fishTypes: any[] = await broker.call('fishTypes.find');
    const res = await request(apiService.server)
      .post('/zvejyba/api/researches')
      .set(apiHelper.getHeaders(investigator.token))
      .send({
        ...baseResearch,
        cadastralId: '00070004',
        fishes: [
          { fishType: fishTypes[0].id, abundance: 10, biomass: 100, abundancePercentage: 1, biomassPercentage: 1 },
        ],
      })
      .expect(200);
    expect(res.body.id).toBeTruthy();
  });

  it('researches.fishes.createOrUpdate creates a new row when none exists, then updates it', async () => {
    const research: any = await broker.call(
      'researches.create',
      { ...baseResearch, cadastralId: '00070099' },
      { meta: apiHelper.meta(apiHelper.superAdmin) },
    );
    const fishTypes: any[] = await broker.call('fishTypes.find');
    const fishTypeId = fishTypes[0].id;

    // First call → create
    const first: any = await broker.call(
      'researches.fishes.createOrUpdate',
      { research: research.id, fishType: fishTypeId, abundance: 5, biomass: 50 },
      { meta: apiHelper.meta(apiHelper.superAdmin) },
    );
    expect(first.id).toBeTruthy();

    // Second call with same research+fishType → update (same id)
    const second: any = await broker.call(
      'researches.fishes.createOrUpdate',
      { research: research.id, fishType: fishTypeId, abundance: 7, biomass: 70 },
      { meta: apiHelper.meta(apiHelper.superAdmin) },
    );
    // Update returns the updated entity, same id as `first`.
    expect(second.id).toBe(first.id);
  });
});
