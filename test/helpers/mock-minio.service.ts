'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Service } from 'moleculer-decorators';
import { RestrictionType } from '../../types';

// In-memory replacement for services/minio.service.ts so tests don't
// need a real MinIO container. The action surface mirrors the real one
// (uploadFile, getUrl, getFile, fileStat, removeFile) plus the helper
// actions that moleculer-minio exposes on the real service
// (getObject, putObject, removeObject, statObject, bucketExists, etc.)
// so any `ctx.call('minio.<helper>')` still resolves.

const storage = new Map<string, { bucket: string; data: Buffer; mimetype: string }>();
const keyOf = (bucket: string, object: string) => `${bucket}/${object}`;

export const MockMinioState = {
  reset() {
    storage.clear();
  },
  put(bucket: string, object: string, data: Buffer | string, mimetype = 'application/octet-stream') {
    storage.set(keyOf(bucket, object), {
      bucket,
      data: Buffer.isBuffer(data) ? data : Buffer.from(data),
      mimetype,
    });
  },
  has(bucket: string, object: string) {
    return storage.has(keyOf(bucket, object));
  },
  list() {
    return Array.from(storage.keys());
  },
};

@Service({
  name: 'minio',
})
export default class MockMinioService extends moleculer.Service {
  // ── high-level actions used by app code ──────────────────────────
  // Auth/rest annotations mirror services/minio.service.ts after the
  // PR #121 fix so the security tests verify the real gating behaviour
  // through the same auth boundary the gateway would apply in prod.
  @Action({
    rest: null,
    auth: RestrictionType.ADMIN,
    params: { folder: 'string' },
  })
  async uploadFile(
    ctx: Context<
      { payload?: any; folder: string; types?: string[]; name?: string; isPrivate?: boolean },
      { mimetype?: string; filename?: string }
    >,
  ) {
    const { folder, name } = ctx.params;
    const filename = name ?? `file-${Date.now()}`;
    const objectName = `${folder}/${filename}.bin`;
    const bucket = process.env.MINIO_BUCKET || 'zvejyba-test';
    MockMinioState.put(bucket, objectName, 'fake-bytes', ctx.meta?.mimetype ?? 'image/png');
    return {
      success: true,
      url: `http://minio.invalid/${bucket}/${objectName}`,
      size: 9,
      filename: ctx.meta?.filename ?? filename,
      path: `${bucket}/${objectName}`,
    };
  }

  @Action({
    rest: null,
    auth: RestrictionType.ADMIN,
    params: { objectName: 'string' },
  })
  async getUrl(ctx: Context<{ bucketName?: string; objectName: string; isPrivate?: boolean }>) {
    const bucket = ctx.params.bucketName || process.env.MINIO_BUCKET || 'zvejyba-test';
    return `http://minio.invalid/${bucket}/${ctx.params.objectName}`;
  }

  // Mirror the real service's rest annotation so the autoAlias is
  // registered — without it the test for the auth gate would hit a 404
  // (route missing) instead of the 401 the real service produces.
  // Post-fix this is `USER` (was PUBLIC) — see PR #121 Finding #2.
  @Action({
    rest: 'GET /:bucket/:name+',
    auth: RestrictionType.USER,
    params: { name: { type: 'array', items: 'string' } },
  })
  async getFile(ctx: Context<{ bucket: string; name: string[] }>) {
    const key = keyOf(ctx.params.bucket, ctx.params.name.join('/'));
    const obj = storage.get(key);
    if (!obj) {
      throw new moleculer.Errors.MoleculerClientError('File not found.', 404, 'NOT_FOUND');
    }
    return obj.data;
  }

  @Action({
    rest: null,
    auth: RestrictionType.ADMIN,
    params: { objectName: 'string' },
  })
  async fileStat(ctx: Context<{ objectName: string; bucketName?: string }>) {
    const bucket = ctx.params.bucketName || process.env.MINIO_BUCKET || 'zvejyba-test';
    const obj = storage.get(keyOf(bucket, ctx.params.objectName));
    return obj ? { exists: true, publicUrl: `http://minio.invalid/${bucket}/${ctx.params.objectName}` } : { exists: false };
  }

  @Action({
    rest: null,
    auth: RestrictionType.ADMIN,
    params: { path: 'string' },
  })
  async removeFile(ctx: Context<{ path: string }>) {
    storage.delete(ctx.params.path);
    return { success: true };
  }

  // ── moleculer-minio compatibility shims ─────────────────────────
  @Action()
  async putObject(ctx: Context<any, { bucketName?: string; objectName?: string; metaData?: any }>) {
    const bucket = ctx.meta?.bucketName ?? '';
    const object = ctx.meta?.objectName ?? '';
    MockMinioState.put(bucket, object, 'fake');
    return { etag: 'fake' };
  }

  @Action()
  async statObject(ctx: Context<{ bucketName: string; objectName: string }>) {
    return storage.has(keyOf(ctx.params.bucketName, ctx.params.objectName))
      ? { size: 9, lastModified: new Date() }
      : { size: 0 };
  }

  @Action()
  async removeObject(ctx: Context<{ bucketName: string; objectName: string }>) {
    storage.delete(keyOf(ctx.params.bucketName, ctx.params.objectName));
    return { ok: true };
  }

  @Action()
  async getObject(ctx: Context<{ bucketName: string; objectName: string }>) {
    const obj = storage.get(keyOf(ctx.params.bucketName, ctx.params.objectName));
    if (!obj) throw new moleculer.Errors.MoleculerClientError('not found', 404, 'NOT_FOUND');
    return obj.data;
  }

  @Action()
  async bucketExists() {
    return true;
  }

  @Action()
  async makeBucket() {
    return { ok: true };
  }

  @Action()
  async presignedUrl(ctx: Context<{ bucketName: string; objectName: string }>) {
    return `http://minio.invalid/${ctx.params.bucketName}/${ctx.params.objectName}?presigned=1`;
  }
}
