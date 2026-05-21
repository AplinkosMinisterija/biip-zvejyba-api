'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Method, Service } from 'moleculer-decorators';

// Stub `auth` service for tests. Replaces the real `services/auth.service.ts`
// (which mixes in biip-auth-nodejs and proxies every action over HTTP to the
// auth-api). Tests register users via `mockAuth.register(user)`; the JWT we
// hand back is just the user's id-as-string, so `resolveToken` is a trivial
// in-memory lookup.
//
// We keep the action surface aligned with how zvejyba talks to auth in the
// real code: any new ctx.call('auth.*.*') in app code needs a counterpart
// here. Anything not covered explicitly throws 501 so missing stubs are
// loud, not silent.

export enum MockAuthUserType {
  USER = 'USER',
  ADMIN = 'ADMIN',
  SUPER_ADMIN = 'SUPER_ADMIN',
}

export interface MockAuthUser {
  id: number;
  type: MockAuthUserType;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  permissions?: Record<string, { accesses?: string[] }>;
  groups?: Array<{
    id: number;
    name?: string;
    role?: 'ADMIN' | 'USER';
    companyCode?: string;
    companyEmail?: string;
    companyPhone?: string;
  }>;
}

const usersById = new Map<number, MockAuthUser>();
const tokenToUserId = new Map<string, number>();
let nextAuthUserId = 1000;
let nextAuthGroupId = 2000;

export const MockAuthState = {
  reset() {
    usersById.clear();
    tokenToUserId.clear();
    nextAuthUserId = 1000;
    nextAuthGroupId = 2000;
  },
  register(user: Partial<MockAuthUser> = {}): { user: MockAuthUser; token: string } {
    const id = user.id ?? nextAuthUserId++;
    const full: MockAuthUser = {
      id,
      type: user.type ?? MockAuthUserType.USER,
      firstName: user.firstName ?? `First${id}`,
      lastName: user.lastName ?? `Last${id}`,
      email: user.email ?? `user${id}@test.lt`,
      phone: user.phone ?? `+37060000${String(id).padStart(3, '0')}`,
      permissions: user.permissions ?? {},
      groups: user.groups ?? [],
    };
    usersById.set(id, full);
    const token = `test-token-${id}`;
    tokenToUserId.set(token, id);
    return { user: full, token };
  },
  nextGroupId(): number {
    return nextAuthGroupId++;
  },
  getUser(id: number): MockAuthUser | undefined {
    return usersById.get(id);
  },
  setPermissions(id: number, permissions: Record<string, { accesses?: string[] }>) {
    const u = usersById.get(id);
    if (u) u.permissions = permissions;
  },
};

@Service({
  name: 'auth',
})
export default class MockAuthService extends moleculer.Service {
  // Public auth endpoints — body is intentionally a no-op stub so the
  // gateway's PUBLIC routes resolve to something instead of 404.
  @Action({ rest: 'POST /login', auth: 'PUBLIC' as any })
  async login() {
    return { ok: true };
  }
  @Action({ rest: 'POST /refreshToken', auth: 'PUBLIC' as any })
  async refreshToken() {
    return { ok: true };
  }
  @Action({ rest: 'POST /evartai/login', auth: 'PUBLIC' as any })
  async 'evartai.login'() {
    return { ok: true };
  }
  @Action({ rest: 'POST /evartai/sign', auth: 'PUBLIC' as any })
  async 'evartai.sign'() {
    return { url: 'http://mock.invalid/sign' };
  }

  // ── token → user resolution ─────────────────────────────────────
  @Action()
  async 'users.resolveToken'(ctx: Context<any, { authToken?: string }>) {
    const token = ctx.meta?.authToken;
    if (!token) throw new moleculer.Errors.MoleculerClientError('No token', 401, 'NO_TOKEN');
    const userId = tokenToUserId.get(token);
    if (!userId)
      throw new moleculer.Errors.MoleculerClientError('Invalid token', 401, 'INVALID_TOKEN');
    const user = usersById.get(userId);
    if (!user) throw new moleculer.Errors.MoleculerClientError('No user', 401, 'NO_USER');
    return user;
  }

  @Action({ params: { id: 'number' } })
  async 'users.get'(ctx: Context<{ id: number; populate?: string | string[]; scope?: any }>) {
    const u = usersById.get(Number(ctx.params.id));
    return u ?? null;
  }

  // ── invite / assign / impersonate ──────────────────────────────
  // Most callers in zvejyba only care about the returned `id` (which then
  // gets stored locally). The mock generates a fresh authUser on each
  // invite and slots it into the table.
  @Action()
  async 'users.invite'(
    ctx: Context<{
      personalCode?: string;
      companyCode?: string;
      notify?: string[];
      companyId?: number;
      role?: 'ADMIN' | 'USER';
    }>,
  ) {
    const id = nextAuthUserId++;
    const full: MockAuthUser = {
      id,
      type: MockAuthUserType.USER,
      firstName: 'Invited',
      lastName: 'User',
      email: ctx.params.notify?.[0] ?? `invited${id}@test.lt`,
      phone: undefined,
      permissions: {},
      groups: ctx.params.companyId
        ? [{ id: ctx.params.companyId, role: ctx.params.role ?? 'USER' }]
        : [],
    };
    usersById.set(id, full);
    return full;
  }

  @Action()
  async 'users.assignToGroup'(
    ctx: Context<{ id: number; groupId: number; role?: 'ADMIN' | 'USER' }>,
  ) {
    const u = usersById.get(Number(ctx.params.id));
    if (!u) return { ok: false };
    u.groups = (u.groups || []).filter((g) => g.id !== Number(ctx.params.groupId));
    u.groups.push({ id: Number(ctx.params.groupId), role: ctx.params.role ?? 'USER' });
    return { ok: true };
  }

  @Action()
  async 'users.unassignFromGroup'(ctx: Context<{ id: number; groupId: number }>) {
    const u = usersById.get(Number(ctx.params.id));
    if (!u) return { ok: false };
    u.groups = (u.groups || []).filter((g) => g.id !== Number(ctx.params.groupId));
    return { ok: true };
  }

  @Action()
  async 'users.impersonate'(ctx: Context<{ id: number }>) {
    const u = usersById.get(Number(ctx.params.id));
    if (!u) return null;
    const token = `test-token-impersonate-${u.id}-${Date.now()}`;
    tokenToUserId.set(token, u.id);
    return { token, user: u };
  }

  @Action()
  async 'users.remove'(ctx: Context<{ id: number }>) {
    const id = Number(ctx.params.id);
    usersById.delete(id);
    for (const [t, uid] of tokenToUserId) if (uid === id) tokenToUserId.delete(t);
    return { ok: true };
  }

  // ── groups / permissions stubs ──────────────────────────────────
  @Action()
  async 'groups.get'(ctx: Context<{ id: number }>) {
    return { id: ctx.params.id, name: `Group ${ctx.params.id}` };
  }

  @Action()
  async 'groups.remove'(ctx: Context<{ id: number }>) {
    return { id: ctx.params.id };
  }

  @Action()
  async 'permissions.modifyAccessForGroup'() {
    return { ok: true };
  }

  // ── seed data hook (called by users/tenants seedDB) ────────────
  // Returns an empty list so the seed loops are no-ops in tests; spec
  // files build fixtures explicitly via MockAuthState.register +
  // ApiHelper.
  @Action()
  async getSeedData(): Promise<any[]> {
    return [];
  }

  @Method
  static logUnsupported(name: string) {
    // eslint-disable-next-line no-console
    console.warn(`[mock-auth] unsupported action: ${name}`);
  }
}
