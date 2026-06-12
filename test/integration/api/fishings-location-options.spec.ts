'use strict';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ServiceBroker } from 'moleculer';
import { ApiHelper, serviceBrokerConfig } from '../../helpers/api';

// `fishings.fishingLocations` powers the journal "location" filter: the
// distinct places the caller actually fished, scoped like the journal itself
// (admin → all, company → its tenant, freelancer → own). Tested with POLDERS
// fishings only — polders resolve from the local table, so no external UETK
// call is needed (that branch is defensively wrapped anyway).
const broker = new ServiceBroker(serviceBrokerConfig);
const apiHelper = new ApiHelper(broker);
apiHelper.initializeServices();

let polderAId: number;
let polderBId: number;

beforeAll(async () => {
  await broker.start();
  await apiHelper.setup();

  const polders: any[] = await broker.call('polders.find');
  polderAId = polders[0].id;
  polderBId = polders[1].id;

  const adminMeta = { authToken: apiHelper.superAdmin.token };
  await broker.call(
    'fishings.create',
    { type: 'POLDERS', tenant: apiHelper.tenantA.tenant.id, user: apiHelper.ownerA.user.id, polderId: polderAId },
    { meta: adminMeta },
  );
  await broker.call(
    'fishings.create',
    { type: 'POLDERS', tenant: apiHelper.tenantB.tenant.id, user: apiHelper.ownerB.user.id, polderId: polderBId },
    { meta: adminMeta },
  );
});
afterAll(() => broker.stop());

const polderIds = (res: any[]) => res.filter((o) => o.polder).map((o) => o.id);

describe('fishings.fishingLocations — journal location options', () => {
  it('a company sees only the locations its own tenant fished', async () => {
    const res: any[] = await broker.call(
      'fishings.fishingLocations',
      {},
      { meta: apiHelper.meta(apiHelper.ownerA, apiHelper.tenantA.tenant.id) },
    );
    const ids = polderIds(res);
    expect(ids).toContain(polderAId);
    expect(ids).not.toContain(polderBId); // never another tenant's location
    // Options carry a name + a `polder` discriminator for the client.
    const opt = res.find((o) => o.id === polderAId);
    expect(opt).toMatchObject({ polder: true });
    expect(typeof opt.name).toBe('string');
  });

  it('an admin sees locations across all tenants', async () => {
    const res: any[] = await broker.call(
      'fishings.fishingLocations',
      {},
      { meta: apiHelper.meta(apiHelper.superAdmin) },
    );
    const ids = polderIds(res);
    expect(ids).toContain(polderAId);
    expect(ids).toContain(polderBId);
  });

  it('a freelancer with no fishings gets an empty list', async () => {
    const res: any[] = await broker.call(
      'fishings.fishingLocations',
      {},
      { meta: apiHelper.meta(apiHelper.freelancerA) },
    );
    expect(res).toEqual([]);
  });
});
