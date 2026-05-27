'use strict';
import Moleculer, { Context } from 'moleculer';
import { Action, Method, Service } from 'moleculer-decorators';
// @ts-ignore
import MinioMixin from 'moleculer-minio';
import moment from 'moment';
import {
  getExtention,
  getMimetype,
  getPublicFileName,
  IMAGE_TYPES,
  MultipartMeta,
  RestrictionType,
  throwNotFoundError,
  throwUnableToUploadError,
  throwUnsupportedMimetypeError,
} from '../types';
import { UserAuthMeta } from './api.service';

export const BUCKET_NAME = () => process.env.MINIO_BUCKET || 'zvejyba';

@Service({
  name: 'minio',
  mixins: [MinioMixin],
  settings: {
    endPoint: process.env.MINIO_ENDPOINT,
    port: parseInt(process.env.MINIO_PORT),
    useSSL: process.env.MINIO_USESSL === 'true',
    accessKey: process.env.MINIO_ACCESSKEY,
    secretKey: process.env.MINIO_SECRETKEY,
  },
})
export default class MinioService extends Moleculer.Service {
  @Action({
    // Internal helper — never expose over HTTP. Without `rest: null`,
    // `mappingPolicy: 'all'` on the api gateway would auto-publish this
    // at `/minio/get-url` and any authenticated USER could enumerate
    // signed/private URLs for arbitrary objects.
    rest: null,
    auth: RestrictionType.ADMIN,
    params: {
      bucketName: {
        type: 'string',
        optional: true,
        default: BUCKET_NAME(),
      },
      objectName: 'string',
      isPrivate: {
        type: 'boolean',
        default: false,
      },
    },
  })
  getUrl(
    ctx: Context<{
      bucketName: string;
      objectName: string;
      isPrivate?: boolean;
    }>,
  ) {
    const { bucketName, objectName, isPrivate } = ctx.params;

    return this.getObjectUrl(objectName, isPrivate, bucketName);
  }

  @Action({
    // Wrapping callers (`researches.upload`, `fishTypes.upload`) reach
    // this via internal `ctx.call`, which bypasses the gateway auth
    // boundary — so locking the HTTP surface to ADMIN does NOT break
    // those flows. It only prevents authenticated USERs from POSTing
    // raw multipart bodies straight at `/minio/upload-file`.
    rest: null,
    auth: RestrictionType.ADMIN,
    params: {
      folder: 'string',
      types: {
        type: 'array',
        items: 'string',
        optional: true,
        default: IMAGE_TYPES,
      },
      name: {
        type: 'string',
        optional: true,
      },
      isPrivate: {
        type: 'boolean',
        default: false,
      },
      presign: {
        type: 'boolean',
        default: false,
      },
    },
    timeout: 0,
  })
  async uploadFile(
    ctx: Context<
      {
        payload: NodeJS.ReadableStream;
        folder: string;
        types: string[];
        name: string;
        presign?: boolean;
        isPrivate?: boolean;
      },
      UserAuthMeta & MultipartMeta & { protected?: boolean }
    >,
  ) {
    const { mimetype, filename } = ctx.meta;
    const { folder, payload, types, isPrivate, name: defaultName, presign } = ctx.params;
    const name = defaultName || getPublicFileName(50);

    if (!types.includes(mimetype)) {
      throwUnsupportedMimetypeError();
    }

    const extension = getExtention(mimetype);

    const objectFileName = `${folder}/${name}.${extension}`;
    const bucketName = BUCKET_NAME();

    try {
      await ctx.call('minio.putObject', payload, {
        meta: {
          bucketName,
          objectName: objectFileName,
          metaData: {
            'Content-Type': mimetype,
          },
        },
      });
    } catch (_e) {
      throwUnableToUploadError();
    }

    const { size }: { size: number } = await ctx.call('minio.statObject', {
      objectName: objectFileName,
      bucketName,
    });

    const url = await ctx.call('minio.getUrl', {
      objectName: objectFileName,
      isPrivate,
      bucketName,
    });

    const response: any = {
      success: true,
      url,
      size,
      filename,
      path: `${bucketName}/${objectFileName}`,
    };

    if (presign) {
      const presignedUrl: string = await this.getPresignedUrl(ctx, objectFileName, bucketName);
      response.presignedUrl = presignedUrl;
    }

    return response;
  }

  @Action({
    params: {
      name: {
        type: 'array',
        items: {
          type: 'string',
          convert: true,
        },
      },
    },
    // Was PUBLIC — let any unauthenticated caller read any private
    // object via the service's MinIO root credentials (see /cso audit
    // Finding #2). Now requires an authenticated USER (or higher);
    // truly public assets (e.g. fishType photos in `uploads/fishTypes/*`)
    // should be served via the direct MinIO URL returned by
    // `minio.getObjectUrl()` — the bucket policy in `started()` already
    // allows anonymous S3 GET on that prefix.
    auth: RestrictionType.USER,
    rest: 'GET /:bucket/:name+',
  })
  async getFile(
    ctx: Context<
      { bucket: string; name: string[] },
      {
        $responseHeaders: any;
        $statusCode: number;
        $statusMessage: string;
        $responseType: string;
      }
    >,
  ) {
    const { bucket, name } = ctx.params;

    // Bucket allowlist: the service-root MinIO credentials can reach
    // every bucket on the cluster (alis, biip-*, etc.). Without this
    // check, an authenticated USER could fetch arbitrary objects from
    // any sibling app's bucket via `GET /minio/<other-bucket>/<path>`
    // (see security audit #C5).
    if (bucket !== BUCKET_NAME()) {
      return throwNotFoundError('File not found.');
    }

    // Path safety: all legit objects live under `uploads/…`. Reject
    // anything else, and explicitly reject path-traversal segments —
    // `..` cannot reach the parent in S3 semantics, but a future
    // proxy/storage rewrite could, so fail closed at the boundary.
    if (
      !name?.length ||
      name[0] !== 'uploads' ||
      name.some((seg) => seg === '..' || seg === '' || seg.includes('/') || seg.includes('\\'))
    ) {
      return throwNotFoundError('File not found.');
    }

    try {
      const reader: NodeJS.ReadableStream = await ctx.call('minio.getObject', {
        bucketName: bucket,
        objectName: name.join('/'),
      });

      const filename = name[name.length - 1];
      const mimetype = getMimetype(filename);
      if (mimetype) {
        ctx.meta.$responseType = mimetype;
      }

      return reader;
    } catch (err) {
      return throwNotFoundError('File not found.');
    }
  }

  @Action({
    // Internal-only — see `getUrl`/`uploadFile` for the rationale.
    rest: null,
    auth: RestrictionType.ADMIN,
    params: {
      objectName: 'string',
      bucketName: {
        type: 'string',
        default: BUCKET_NAME(),
      },
    },
  })
  async fileStat(ctx: Context<{ bucketName: string; objectName: string }>) {
    const { bucketName, objectName } = ctx.params;

    const response: any = {
      exists: false,
    };
    try {
      const data: any = await ctx.call('minio.statObject', {
        bucketName,
        objectName,
      });

      response.exists = data?.size > 0;

      if (response.exists) {
        const presignedUrl: string = await this.getPresignedUrl(ctx, objectName, bucketName);

        response.publicUrl = this.getObjectUrl(objectName, false, bucketName);
        response.privateUrl = this.getObjectUrl(objectName, true, bucketName);
        response.presignedUrl = presignedUrl;
        response.lastModified = moment(data.lastModified).format();
      }

      return response;
    } catch (err) {}

    return response;
  }

  @Action({
    // Was auto-exposed at `POST /minio/remove-file` with `auth: DEFAULT`,
    // letting any authenticated USER pass `{ path: "<bucket>/<other-user-file>" }`
    // and delete arbitrary objects (no ownership check). See /cso audit
    // Finding #3. Lock to ADMIN over HTTP; internal callers (if any)
    // still reach it via `ctx.call`.
    rest: null,
    auth: RestrictionType.ADMIN,
    params: {
      path: 'string',
    },
  })
  async removeFile(ctx: Context<{ path: string }>) {
    const { path } = ctx.params;

    const [bucket, ...paths] = path.split('/');

    // Bucket allowlist — same reason as `getFile` above: the service's
    // MinIO root credentials can touch every bucket on the cluster, so a
    // pathological caller (or future bug that lowers this action's auth
    // tier) could delete objects in sibling biip apps' buckets (see
    // security audit #H9). Fail closed at the boundary.
    if (bucket !== BUCKET_NAME()) {
      return { sucess: false };
    }

    try {
      const result = await ctx.call('minio.removeObject', {
        bucketName: bucket,
        objectName: paths.join('/'),
      });
      return { sucess: !result };
    } catch (err) {
      return { succes: false };
    }
  }

  async started() {
    try {
      const bucketExists: boolean = await this.actions.bucketExists({
        bucketName: BUCKET_NAME(),
      });

      if (!bucketExists) {
        await this.actions.makeBucket({
          bucketName: BUCKET_NAME(),
        });

        await this.client.setBucketPolicy(
          BUCKET_NAME(),
          JSON.stringify({
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Principal: {
                  AWS: ['*'],
                },
                Action: ['s3:GetObject'],
                Resource: [`arn:aws:s3:::${BUCKET_NAME()}/uploads/fishTypes/*`],
              },
            ],
          }),
        );

        await this.client.setBucketLifecycle(BUCKET_NAME(), {
          Rule: [
            {
              ID: 'Expiration Rule For Temp Files',
              Status: 'Enabled',
              Filter: {
                Prefix: 'temp/*',
              },
              Expiration: {
                Days: '7',
              },
            },
          ],
        });
      }
    } catch (err) {
      this.broker.logger.fatal(err);
    }
  }

  @Method
  getObjectUrl(objectName: string, isPrivate: boolean = false, bucketName: string = BUCKET_NAME()) {
    const hasSSL = process.env.MINIO_USESSL === 'true';

    let hostUrl = `http${hasSSL ? 's' : ''}://${process.env.MINIO_ENDPOINT}`;

    if (isPrivate) {
      hostUrl = `${process.env.SERVER_HOST}/minio`;
    }

    return `${hostUrl}/${bucketName}/${objectName}`;
  }

  @Method
  getPresignedUrl(
    ctx: Context,
    objectName: string,
    bucketName: string = BUCKET_NAME(),
  ): Promise<string> {
    return ctx.call('minio.presignedUrl', {
      bucketName,
      objectName,
      httpMethod: 'GET',
      expires: 60 * 60 * 24 * 7, // 1 week
      reqParams: {},
      requestDate: moment().format(),
    });
  }

  created() {
    if (!process.env.MINIO_ACCESSKEY || !process.env.MINIO_SECRETKEY) {
      this.broker.fatal('MINIO is not configured');
    }
  }
}
