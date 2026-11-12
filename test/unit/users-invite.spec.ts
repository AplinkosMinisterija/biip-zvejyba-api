'use strict';
import { describe, expect, it, jest } from '@jest/globals';
import moleculer from 'moleculer';
import UsersService from '../../services/users.service';

const AUTH_USER = { id: 77 };
const PARAMS = {
  personalCode: '36503240400',
  email: 'giedrius@example.lt',
  phone: '+37060000000',
  firstName: 'Giedrius',
  lastName: 'Ladukas',
  isInvestigator: false,
};

// Emulates auth's `usersEvartai.invite`: once the person exists there with the
// app attached, it only throws when the caller asked it to.
function buildContext({
  authUserExists,
  localUserExists,
  authReturnsNothing = false,
}: {
  authUserExists: boolean;
  localUserExists: boolean;
  authReturnsNothing?: boolean;
}) {
  const call = jest.fn(async (action: string, params: any) => {
    if (action === 'auth.users.invite') {
      if (authUserExists && params.throwErrors) {
        throw new moleculer.Errors.ValidationError(
          `User with personal code '${params.personalCode}' already exists.`,
          'AUTH_USER_EXISTS',
        );
      }
      return authReturnsNothing ? null : AUTH_USER;
    }
    if (action === 'users.findOne') return localUserExists ? { id: 5, authUser: 77 } : null;
    if (action === 'auth.users.assignToGroup') return { id: 1 };
    throw new Error(`unexpected call: ${action}`);
  });

  return { call, params: PARAMS } as any;
}

function buildService() {
  const createEntity = jest.fn(async (_ctx: any, data: any) => ({ id: 9, ...data }));
  return { createEntity } as any;
}

const invite = (UsersService as any).prototype.invite;

describe('users.invite', () => {
  it('creates the local record for a brand new person', async () => {
    const ctx = buildContext({ authUserExists: false, localUserExists: false });
    const service = buildService();

    const result = await invite.call(service, ctx);

    expect(result).toMatchObject({ authUser: 77, firstName: 'Giedrius', isFreelancer: true });
    expect(ctx.call).toHaveBeenCalledWith(
      'auth.users.assignToGroup',
      expect.objectContaining({ id: 77 }),
    );
  });

  it('recovers when auth already holds the person but we never recorded them', async () => {
    const ctx = buildContext({ authUserExists: true, localUserExists: false });
    const service = buildService();

    const result = await invite.call(service, ctx);

    expect(result).toMatchObject({ authUser: 77 });
    expect(service.createEntity).toHaveBeenCalledTimes(1);
  });

  it('asks auth to send the invitation even when auth already holds the person', async () => {
    const ctx = buildContext({ authUserExists: true, localUserExists: false });

    await invite.call(buildService(), ctx);

    expect(ctx.call).toHaveBeenCalledWith(
      'auth.users.invite',
      expect.objectContaining({ throwErrors: false, notifyIfExists: true }),
    );
  });

  it('fails loudly instead of writing a null reference when auth returns no user', async () => {
    const ctx = buildContext({
      authUserExists: false,
      localUserExists: false,
      authReturnsNothing: true,
    });
    const service = buildService();

    await expect(invite.call(service, ctx)).rejects.toMatchObject({
      type: 'AUTH_INVITE_FAILED',
    });
    expect(service.createEntity).not.toHaveBeenCalled();
  });

  it('still rejects a genuine duplicate, with the error type the UI maps', async () => {
    const ctx = buildContext({ authUserExists: true, localUserExists: true });
    const service = buildService();

    await expect(invite.call(service, ctx)).rejects.toMatchObject({ type: 'AUTH_USER_EXISTS' });
    expect(service.createEntity).not.toHaveBeenCalled();
  });
});
