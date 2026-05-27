import { randomBytes } from 'crypto';
import mime from 'mime-types';
import Moleculer, { Errors } from 'moleculer';

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg'];

export const FILE_TYPES = ['application/pdf'];

export const ALL_FILE_TYPES = [...IMAGE_TYPES, ...FILE_TYPES];

export function getExtention(mimetype: string) {
  return mime.extension(mimetype);
}

export function getMimetype(filename: string) {
  return mime.lookup(filename);
}

export function throwUnsupportedMimetypeError(): Errors.MoleculerError {
  throw new Moleculer.Errors.MoleculerClientError(
    'Unsupported MIME type.',
    400,
    'UNSUPPORTED_MIMETYPE',
  );
}

export function throwUnableToUploadError(): Errors.MoleculerError {
  throw new Moleculer.Errors.MoleculerClientError(
    'Unable to upload file.',
    400,
    'UNABLE_TO_UPLOAD',
  );
}

// Cryptographically-strong random filename. Previous implementation used
// `Math.random()`, which seeds V8's PRNG with low entropy — an attacker
// that observes a handful of uploaded filenames can recover the PRNG
// state and predict the next ones. Combined with `isPrivate: true`
// objects (which rely on path obscurity), that meant private uploads
// were enumerable. See security audit #C6.
export function getPublicFileName(length: number = 30) {
  // base64url emits ~4 chars per 3 bytes, so request enough bytes to
  // cover the requested length and then trim.
  const bytes = randomBytes(Math.ceil((length * 3) / 4));
  return bytes.toString('base64url').slice(0, length);
}
