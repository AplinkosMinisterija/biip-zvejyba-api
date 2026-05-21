// Jest env bootstrap. Mirrors what biip-infra would set, but pointed at
// the local docker-compose Postgres (port 5331) and Redis (port 5691).
// We intentionally do NOT set MINIO_ACCESSKEY / MINIO_SECRETKEY here —
// the test broker registers a mock `minio` service before any service
// boots, so the real `minio.service.ts` never runs its `created()`
// fail-fast guard against missing creds.
process.env.NODE_ENV = 'test';
process.env.PORT = '0';
process.env.URL = 'http://localhost:3000';
process.env.SERVER_HOST = 'http://localhost:3000';

// docker-compose.yml maps postgres :5432 → host :5644 and redis :6379 → :5691.
process.env.DB_CONNECTION =
  process.env.DB_CONNECTION || 'postgresql://postgres:postgres@localhost:5644/zvejyba';
process.env.REDIS_CONNECTION = process.env.REDIS_CONNECTION || 'redis://localhost:5691';

// auth-api credentials — real auth-api never gets contacted in tests
// (the mock-auth service intercepts every `auth.*.*` call).
process.env.AUTH_API_KEY = 'test-api-key';
process.env.AUTH_HOST = 'http://auth-api-mock.invalid';

process.env.FREELANCER_GROUP_ID = '90001';
process.env.AUTH_INVESTIGATOR_GROUP_ID = '90002';

process.env.MINIO_ENDPOINT = 'minio.invalid';
process.env.MINIO_PORT = '9000';
process.env.MINIO_USESSL = 'false';
process.env.MINIO_ACCESSKEY = 'test';
process.env.MINIO_SECRETKEY = 'test';
process.env.MINIO_BUCKET = 'zvejyba-test';

process.env.UETK_URL = 'http://uetk.invalid';
process.env.GEO_SERVER = 'http://geo.invalid';

// Stub out fetch() with a benign default. Several services (locations,
// uetkSearchByCadastralId, etc.) reach external GIS endpoints during
// populate chains; without this the tests would die with "fetch failed"
// the moment any nested populate kicked in. Individual specs can still
// `jest.spyOn(global, 'fetch')` to override the default with richer
// fixtures.
global.fetch = () =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ rows: [], features: [] }),
    text: () => Promise.resolve(''),
  });
