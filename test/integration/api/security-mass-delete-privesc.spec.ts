'use strict';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ServiceBroker } from 'moleculer';
import request from 'supertest';
import { ApiHelper, serviceBrokerConfig } from '../../helpers/api';

// Regression coverage for the security audit batch that closed three
// systemic holes, all rooted in `mappingPolicy: 'all'` + per-verb scoping:
//   1) `removeAllEntities` (unscoped hard DELETE) reachable by any USER →
//      mass table wipe across every tenant.
//   2) nested `$raw` in the user `query` reaching the knex `whereRaw` sink →
//      arbitrary SQL injection on every list endpoint.
//   3) the generic `tenantUsers.update` / `remove` (no ownership scope,
//      free-form `role`) → USER self-promotion + cross-tenant membership
//      tampering.

const broker = new ServiceBroker(serviceBrokerConfig);
const apiHelper = new ApiHelper(broker);
const apiService = apiHelper.initializeServices();

beforeAll(async () => {
  await broker.start();
  await apiHelper.setup();
});
afterAll(() => broker.stop());

async function tenantUserId(userId: number | string, tenantId: number | string): Promise<number> {
  const rows: any[] = await broker.call(
    'tenantUsers.find',
    { query: { user: userId, tenant: tenantId } },
    { meta: apiHelper.meta(apiHelper.superAdmin) },
  );
  return rows[0].id;
}

describe('mass deletion — removeAllEntities is not HTTP-reachable', () => {
  it('USER cannot POST /<service>/removeAllEntities (wipe is refused)', async () => {
    const seeded: any = await broker.call(
      'fishings.create',
      {
        type: 'INLAND_WATERS',
        tenant: apiHelper.tenantA.tenant.id,
        user: apiHelper.ownerA.user.id,
      },
      { meta: { authToken: apiHelper.superAdmin.token } },
    );

    const res = await request(apiService.server)
      .post('/zvejyba/api/fishings/removeAllEntities')
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id));
    // `protected` → moleculer-web refuses to serve it.
    expect(res.status).toBe(404);

    // The seeded row is untouched.
    const after: any = await broker.call(
      'fishings.get',
      { id: seeded.id },
      { meta: apiHelper.meta(apiHelper.superAdmin) },
    );
    expect(after.id).toBe(seeded.id);
  });

  it('internal broker.call still wipes (seed/test path keeps working)', async () => {
    await broker.call('fishings.removeAllEntities');
    const count: number = await broker.call(
      'fishings.count',
      {},
      { meta: apiHelper.meta(apiHelper.superAdmin) },
    );
    expect(count).toBe(0);
  });
});

describe('SQL injection — nested $raw is stripped from the user query', () => {
  it('USER find with a NESTED $raw runs clean (operator removed, no SQL error)', async () => {
    // If the nested `$raw` survived, it would reach `whereRaw('…not sql…')`
    // and Postgres would reject the statement → the call rejects. A resolved
    // array proves the operator was stripped before the adapter saw it.
    const res: any = await broker.call(
      'fishings.find',
      { query: { id: { $gte: 0, $raw: 'this_is_not_valid_sql' } } },
      { meta: apiHelper.meta(apiHelper.ownerA, apiHelper.tenantA.tenant.id) },
    );
    expect(Array.isArray(res)).toBe(true);
  });

  it('USER find with a $raw nested under $or is also stripped', async () => {
    const res: any = await broker.call(
      'fishings.find',
      { query: { $or: [{ id: { $gte: 0, $raw: 'definitely; not; sql' } }] } },
      { meta: apiHelper.meta(apiHelper.ownerA, apiHelper.tenantA.tenant.id) },
    );
    expect(Array.isArray(res)).toBe(true);
  });

  it('top-level $raw remains stripped (prior fix regression)', async () => {
    const res: any = await broker.call(
      'fishings.find',
      { query: { $raw: 'still_not_sql' } },
      { meta: apiHelper.meta(apiHelper.ownerA, apiHelper.tenantA.tenant.id) },
    );
    expect(Array.isArray(res)).toBe(true);
  });
});

describe('privilege escalation — generic tenantUsers.update is ADMIN-only', () => {
  it('USER cannot PATCH /tenantUsers/:id to self-promote to OWNER', async () => {
    const tuId = await tenantUserId(apiHelper.userA.user.id, apiHelper.tenantA.tenant.id);

    const res = await request(apiService.server)
      .patch(`/zvejyba/api/tenantUsers/${tuId}`)
      .set(apiHelper.getHeaders(apiHelper.userA.token, apiHelper.tenantA.tenant.id))
      .send({ role: 'OWNER' });
    expect([401, 403]).toContain(res.status);

    const after: any = await broker.call(
      'tenantUsers.resolve',
      { id: tuId },
      { meta: apiHelper.meta(apiHelper.superAdmin) },
    );
    expect(after.role).toBe('USER');
  });

  it('USER cannot reach the generic update via the /tenantUsers/update fallback URL', async () => {
    const tuId = await tenantUserId(apiHelper.userA.user.id, apiHelper.tenantA.tenant.id);

    const res = await request(apiService.server)
      .post('/zvejyba/api/tenantUsers/update')
      .set(apiHelper.getHeaders(apiHelper.userA.token, apiHelper.tenantA.tenant.id))
      .send({ id: tuId, role: 'OWNER' });
    expect([401, 403, 404]).toContain(res.status);

    const after: any = await broker.call(
      'tenantUsers.resolve',
      { id: tuId },
      { meta: apiHelper.meta(apiHelper.superAdmin) },
    );
    expect(after.role).toBe('USER');
  });
});

describe('tenantUsers delete is guarded (beforeRemove) — OWNER keeps control', () => {
  it('OWNER CAN delete a member of their OWN tenant', async () => {
    const member = await apiHelper.makeTenantMember(apiHelper.tenantA, 'USER' as any);
    const tuId = await tenantUserId(member.user.id, apiHelper.tenantA.tenant.id);

    const res = await request(apiService.server)
      .delete(`/zvejyba/api/tenantUsers/${tuId}`)
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id));
    expect(res.status).toBe(200);
  });

  it('OWNER of tenantA CANNOT delete a member of tenantB (cross-tenant IDOR)', async () => {
    const tuB = await tenantUserId(apiHelper.ownerB.user.id, apiHelper.tenantB.tenant.id);

    const res = await request(apiService.server)
      .delete(`/zvejyba/api/tenantUsers/${tuB}`)
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id));
    expect([401, 403]).toContain(res.status);

    const still: any = await broker.call(
      'tenantUsers.resolve',
      { id: tuB, throwIfNotExist: false },
      { meta: apiHelper.meta(apiHelper.superAdmin) },
    );
    expect(still?.id).toBe(tuB);
  });

  it('plain USER (role USER) cannot delete a member', async () => {
    const member = await apiHelper.makeTenantMember(apiHelper.tenantA, 'USER' as any);
    const tuId = await tenantUserId(member.user.id, apiHelper.tenantA.tenant.id);

    const res = await request(apiService.server)
      .delete(`/zvejyba/api/tenantUsers/${tuId}`)
      .set(apiHelper.getHeaders(apiHelper.userA.token, apiHelper.tenantA.tenant.id));
    expect([401, 403]).toContain(res.status);
  });
});

// The guards above MUST NOT over-block the legitimate flow: a tenant OWNER
// (and USER_ADMIN, via the same `validateCanEditTenantUser` gate) keeps full
// control of their OWN tenant's members — add, edit, delete. Each test asserts
// the change actually took effect, not just a 200.
describe('tenant OWNER keeps full member management (add / edit / delete)', () => {
  it('OWNER can ADD a member via POST /tenantUsers/invite', async () => {
    const res = await request(apiService.server)
      .post('/zvejyba/api/tenantUsers/invite')
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id))
      .send({
        firstName: 'Added',
        lastName: 'Member',
        personalCode: '39010101010',
        role: 'USER',
        email: 'added.member@test.lt',
      })
      .expect(200);

    expect(res.body.role).toBe('USER');
    expect(String(res.body.tenant)).toBe(String(apiHelper.tenantA.tenant.id));

    // The membership row really exists in the OWNER's tenant.
    const created: any = await broker.call(
      'tenantUsers.resolve',
      { id: res.body.id },
      { meta: apiHelper.meta(apiHelper.superAdmin) },
    );
    expect(String(created.tenant)).toBe(String(apiHelper.tenantA.tenant.id));
  });

  it('OWNER can EDIT a member`s role + contact via PATCH /tenantUsers/update/:id', async () => {
    const member = await apiHelper.makeTenantMember(apiHelper.tenantA, 'USER' as any);
    const tuId = await tenantUserId(member.user.id, apiHelper.tenantA.tenant.id);

    await request(apiService.server)
      .patch(`/zvejyba/api/tenantUsers/update/${tuId}`)
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id))
      .send({ role: 'USER_ADMIN', email: 'edited.member@test.lt', phone: '+37061122334' })
      .expect(200);

    // Role change persisted on the membership…
    const tu: any = await broker.call(
      'tenantUsers.resolve',
      { id: tuId },
      { meta: apiHelper.meta(apiHelper.superAdmin) },
    );
    expect(tu.role).toBe('USER_ADMIN');

    // …and contact details persisted on the member's user.
    const u: any = await broker.call(
      'users.resolve',
      { id: member.user.id },
      { meta: apiHelper.meta(apiHelper.superAdmin) },
    );
    expect(u.email).toBe('edited.member@test.lt');
    expect(u.phone).toBe('+37061122334');
  });

  it('OWNER can edit email/phone with the member`s CURRENT role (the web-form shape)', async () => {
    // Exactly the failing real request: the form resubmits the unchanged role
    // (`USER`) alongside new contact details. This must NOT trigger an auth
    // group reassignment — only the contact fields change.
    const member = await apiHelper.makeTenantMember(apiHelper.tenantA, 'USER' as any);
    const tuId = await tenantUserId(member.user.id, apiHelper.tenantA.tenant.id);

    await request(apiService.server)
      .patch(`/zvejyba/api/tenantUsers/update/${tuId}`)
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id))
      .send({ email: 'contact.only@test.lt', phone: '064421421', role: 'USER' })
      .expect(200);

    const u: any = await broker.call(
      'users.resolve',
      { id: member.user.id },
      { meta: apiHelper.meta(apiHelper.superAdmin) },
    );
    expect(u.email).toBe('contact.only@test.lt');
    expect(u.phone).toBe('064421421');

    const tu: any = await broker.call(
      'tenantUsers.resolve',
      { id: tuId },
      { meta: apiHelper.meta(apiHelper.superAdmin) },
    );
    expect(tu.role).toBe('USER');
  });

  it('OWNER can edit email/phone with NO role field at all', async () => {
    const member = await apiHelper.makeTenantMember(apiHelper.tenantA, 'USER' as any);
    const tuId = await tenantUserId(member.user.id, apiHelper.tenantA.tenant.id);

    await request(apiService.server)
      .patch(`/zvejyba/api/tenantUsers/update/${tuId}`)
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id))
      .send({ email: 'norole@test.lt', phone: '+37060001112' })
      .expect(200);

    const u: any = await broker.call(
      'users.resolve',
      { id: member.user.id },
      { meta: apiHelper.meta(apiHelper.superAdmin) },
    );
    expect(u.email).toBe('norole@test.lt');
  });

  it('OWNER can DELETE a member via DELETE /tenantUsers/:id (row removed)', async () => {
    const member = await apiHelper.makeTenantMember(apiHelper.tenantA, 'USER' as any);
    const tuId = await tenantUserId(member.user.id, apiHelper.tenantA.tenant.id);

    await request(apiService.server)
      .delete(`/zvejyba/api/tenantUsers/${tuId}`)
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id))
      .expect(200);

    const gone: any = await broker.call(
      'tenantUsers.resolve',
      { id: tuId, throwIfNotExist: false },
      { meta: apiHelper.meta(apiHelper.superAdmin) },
    );
    expect(gone).toBeFalsy();
  });
});
