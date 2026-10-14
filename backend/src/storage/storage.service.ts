import { Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve } from 'node:path';
import { env } from '../config/env.js';

/**
 * File storage with two drivers:
 * - local (default, free): files under UPLOAD_DIR on this computer;
 * - s3: Cloudflare R2 (10 GB free, no download fees), AWS S3 or any S3-compatible bucket.
 * Keys look like "submissions/<id>/page-1.jpg". Files are only ever reached through short-lived signed
 * links, so student copies are never public. Phones upload straight to storage with presigned PUT links,
 * so image bytes never pass through the API.
 */
@Injectable()
export class StorageService {
  private readonly log = new Logger('Storage');
  private readonly root = resolve(env.uploadDir);
  private s3?: { client: any; presign: any; cmds: any };

  private get isS3() {
    return env.storageDriver === 's3';
  }

  private async s3c() {
    if (!this.s3) {
      const cmds = await import('@aws-sdk/client-s3');
      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
      const client = new cmds.S3Client({
        region: env.s3Region,
        endpoint: env.s3Endpoint || undefined,
        credentials: { accessKeyId: env.s3AccessKeyId, secretAccessKey: env.s3SecretAccessKey },
        forcePathStyle: !!env.s3Endpoint,
      });
      this.s3 = { client, presign: getSignedUrl, cmds };
    }
    return this.s3;
  }

  private abs(key: string) {
    const p = normalize(join(this.root, key));
    if (!p.startsWith(this.root) || key.includes('..')) throw new Error('Invalid file key');
    return p;
  }

  async save(key: string, data: Buffer, contentType = 'image/jpeg'): Promise<string> {
    if (this.isS3) {
      const { client, cmds } = await this.s3c();
      await client.send(new cmds.PutObjectCommand({ Bucket: env.s3Bucket, Key: key, Body: data, ContentType: contentType }));
      return key;
    }
    const p = this.abs(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, data);
    return key;
  }

  async read(key: string): Promise<Buffer> {
    if (this.isS3) {
      const { client, cmds } = await this.s3c();
      const res = await client.send(new cmds.GetObjectCommand({ Bucket: env.s3Bucket, Key: key }));
      return Buffer.from(await res.Body.transformToByteArray());
    }
    return readFile(this.abs(key));
  }

  async exists(key: string): Promise<boolean> {
    if (this.isS3) {
      const { client, cmds } = await this.s3c();
      try {
        await client.send(new cmds.HeadObjectCommand({ Bucket: env.s3Bucket, Key: key }));
        return true;
      } catch {
        return false;
      }
    }
    try {
      return (await stat(this.abs(key))).isFile();
    } catch {
      return false;
    }
  }

  async remove(key: string) {
    if (this.isS3) {
      const { client, cmds } = await this.s3c();
      await client.send(new cmds.DeleteObjectCommand({ Bucket: env.s3Bucket, Key: key })).catch(() => undefined);
      return;
    }
    await rm(this.abs(key), { force: true });
  }

  /** Removes every file under a prefix ("submissions/<id>"). */
  async removeDir(prefix: string) {
    if (this.isS3) {
      const { client, cmds } = await this.s3c();
      let token: string | undefined;
      do {
        const list = await client.send(new cmds.ListObjectsV2Command({ Bucket: env.s3Bucket, Prefix: `${prefix.replace(/\/$/, '')}/`, ContinuationToken: token }));
        const objects = (list.Contents ?? []).map((o: any) => ({ Key: o.Key }));
        if (objects.length) await client.send(new cmds.DeleteObjectsCommand({ Bucket: env.s3Bucket, Delete: { Objects: objects } }));
        token = list.IsTruncated ? list.NextContinuationToken : undefined;
      } while (token);
      return;
    }
    await rm(this.abs(prefix), { recursive: true, force: true });
  }

  /** Local driver only: path on disk. */
  absolutePath(key: string) {
    const p = this.abs(key);
    return existsSync(p) ? p : null;
  }

  /** Relative signed URL served by this API (/files). With S3 the API redirects to a fresh presigned link. */
  signedUrl(key: string | null | undefined, ttlMinutes = env.fileUrlTtlMinutes): string | null {
    if (!key) return null;
    const exp = Math.floor(Date.now() / 1000) + ttlMinutes * 60;
    const sig = this.sign(`get:${key}:${exp}`);
    return `/files?key=${encodeURIComponent(key)}&exp=${exp}&sig=${sig}`;
  }

  /** Presigned GET straight to the bucket (S3 driver). */
  async bucketUrl(key: string): Promise<string> {
    const { client, presign, cmds } = await this.s3c();
    return presign(client, new cmds.GetObjectCommand({ Bucket: env.s3Bucket, Key: key }), { expiresIn: 600 });
  }

  /** Where a phone may PUT one file (expires in 15 minutes). */
  async presignPut(key: string, contentType = 'image/jpeg'): Promise<{ url: string; method: 'PUT'; headers: Record<string, string> }> {
    if (this.isS3) {
      const { client, presign, cmds } = await this.s3c();
      const url = await presign(client, new cmds.PutObjectCommand({ Bucket: env.s3Bucket, Key: key, ContentType: contentType }), { expiresIn: 900 });
      return { url, method: 'PUT', headers: { 'content-type': contentType } };
    }
    const exp = Math.floor(Date.now() / 1000) + 900;
    const sig = this.sign(`put:${key}:${exp}`);
    return { url: `${env.publicApiUrl}/files/upload?key=${encodeURIComponent(key)}&exp=${exp}&sig=${sig}`, method: 'PUT', headers: { 'content-type': contentType } };
  }

  verify(key: string, exp: number, sig: string, action: 'get' | 'put' = 'get'): boolean {
    if (!key || !exp || !sig || exp < Date.now() / 1000) return false;
    const expected = Buffer.from(this.sign(`${action}:${key}:${exp}`));
    const given = Buffer.from(sig);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  private sign(v: string) {
    return createHmac('sha256', env.fileSigningSecret).update(v).digest('base64url');
  }
}
