/**
 * Voice sample storage utilities.
 *
 * Production stores samples in S3/CloudFront.
 * Non-production stores samples on the local filesystem under data/voice-samples.
 */

import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { promises as fs } from "node:fs";
import path from "node:path";
import { safeDownload } from "@/utils/security/safeDownload";
import { log } from "@/utils/misc/logger";

type VoiceSampleStoreOptions = {
  serverId: number;
  sampleId: number;
  buffer: Buffer;
};

type VoiceSampleStorageConfig = {
  bucket: string;
  region: string;
  prefix: string;
  publicBaseUrl: string;
};

const IS_PRODUCTION = process.env.RUN_ENV === "production";
const LOCAL_VOICE_SAMPLE_BASE_DIR = path.resolve(process.cwd(), "data", "voice-samples");
const LOCAL_VOICE_SAMPLE_ROOT_PREFIX = "data/voice-samples/";
const SPEECH_SAMPLE_MAX_MB = Math.max(1, Number.parseInt(process.env.SPEECH_SAMPLE_MAX_MB ?? "10", 10) || 10);
let cachedClient: S3Client | null = null;
let cachedRegion: string | null = null;

function getVoiceSampleStorageConfig(): VoiceSampleStorageConfig | null {
  if (!IS_PRODUCTION) {
    return null;
  }

  const bucket = process.env.VOICE_SAMPLE_S3_BUCKET?.trim() || process.env.AVATAR_S3_BUCKET?.trim();
  if (!bucket) {
    log.warn("[Voice Sample Storage] VOICE_SAMPLE_S3_BUCKET is missing; falling back to local storage.");
    return null;
  }

  const region =
    process.env.VOICE_SAMPLE_S3_REGION?.trim() ||
    process.env.AVATAR_S3_REGION?.trim() ||
    process.env.AWS_REGION?.trim() ||
    "us-east-1";
  const prefix = (process.env.VOICE_SAMPLE_S3_PREFIX || "voice-samples").replace(/^\/+/, "").replace(/\/+$/, "");
  const publicBaseUrl =
    process.env.VOICE_SAMPLE_PUBLIC_BASE_URL?.trim() ||
    process.env.AVATAR_PUBLIC_BASE_URL?.trim() ||
    `https://${bucket}.s3.${region}.amazonaws.com`;

  return {
    bucket,
    region,
    prefix,
    publicBaseUrl,
  };
}

function getS3Client(region: string): S3Client {
  if (!cachedClient || cachedRegion !== region) {
    cachedRegion = region;
    cachedClient = new S3Client({ region });
  }
  return cachedClient;
}

function buildVoiceSampleObjectKey(config: VoiceSampleStorageConfig, options: VoiceSampleStoreOptions): string {
  return `${config.prefix}/servers/${options.serverId}/samples/${options.sampleId}.wav`;
}

function buildPublicUrl(config: VoiceSampleStorageConfig, key: string): string {
  const baseUrl = config.publicBaseUrl.replace(/\/+$/, "");
  return `${baseUrl}/${key}`;
}

function buildLocalStoredPath(options: VoiceSampleStoreOptions): string {
  return path.posix.join("data", "voice-samples", String(options.serverId), `${options.sampleId}.wav`);
}

function normalizeStoredPath(storedPath: string): string {
  return storedPath.replace(/\\/g, "/").replace(/^\/+/, "");
}

function resolveLocalVoiceSamplePath(reference: string): string | null {
  const normalizedPath = normalizeStoredPath(reference);
  const pathFromCwd = normalizedPath.startsWith(LOCAL_VOICE_SAMPLE_ROOT_PREFIX)
    ? normalizedPath
    : path.posix.join(LOCAL_VOICE_SAMPLE_ROOT_PREFIX, normalizedPath);
  const resolvedPath = path.resolve(process.cwd(), pathFromCwd);
  const relativePath = path.relative(LOCAL_VOICE_SAMPLE_BASE_DIR, resolvedPath);

  if (relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))) {
    return resolvedPath;
  }

  log.warn(`[Voice Sample Storage] Rejected path outside data/voice-samples: ${reference}`);
  return null;
}

function extractKeyFromVoiceSampleUrl(config: VoiceSampleStorageConfig, url: string): string | null {
  try {
    const parsed = new URL(url);
    const baseHost = new URL(config.publicBaseUrl).hostname;
    const hostname = parsed.hostname;
    const pathName = parsed.pathname.replace(/^\/+/, "");

    if (hostname !== baseHost) {
      const s3Host = `${config.bucket}.s3.${config.region}.amazonaws.com`;
      const s3HostLegacy = `${config.bucket}.s3.amazonaws.com`;
      if (hostname !== s3Host && hostname !== s3HostLegacy) {
        return null;
      }
    }

    if (!pathName.startsWith(`${config.prefix}/`)) {
      return null;
    }

    return pathName;
  } catch {
    return null;
  }
}

async function storeVoiceSampleLocally(options: VoiceSampleStoreOptions): Promise<string | null> {
  const storedPath = buildLocalStoredPath(options);
  const absolutePath = resolveLocalVoiceSamplePath(storedPath);
  if (!absolutePath) {
    return null;
  }

  try {
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, options.buffer);
    log.success(`[Voice Sample Storage] Stored voice sample at ${storedPath}`);
    return normalizeStoredPath(storedPath);
  } catch (error) {
    log.warn(`[Voice Sample Storage] Failed to store voice sample locally`, error);
    return null;
  }
}

export async function storeVoiceSample(options: VoiceSampleStoreOptions): Promise<string | null> {
  if (IS_PRODUCTION) {
    const config = getVoiceSampleStorageConfig();
    if (config) {
      const key = buildVoiceSampleObjectKey(config, options);
      const client = getS3Client(config.region);

      try {
        await client.send(
          new PutObjectCommand({
            Bucket: config.bucket,
            Key: key,
            Body: options.buffer,
            ContentType: "audio/wav",
            CacheControl: "public, max-age=31536000, immutable",
          }),
        );
        const publicUrl = buildPublicUrl(config, key);
        log.success(`[Voice Sample Storage] Uploaded voice sample to S3 (${publicUrl})`);
        return publicUrl;
      } catch (error) {
        log.warn("[Voice Sample Storage] Failed to upload voice sample to S3", error);
        return null;
      }
    }
  }

  return storeVoiceSampleLocally(options);
}

export async function loadStoredVoiceSampleBuffer(reference: string): Promise<Buffer | null> {
  const trimmedReference = reference.trim();
  if (!trimmedReference) {
    return null;
  }

  if (/^https?:\/\//i.test(trimmedReference)) {
    const downloadResult = await safeDownload(trimmedReference, {
      maxSizeMB: SPEECH_SAMPLE_MAX_MB,
      timeoutMs: 30_000,
    });

    if (!downloadResult.success || !downloadResult.buffer) {
      return null;
    }

    return downloadResult.buffer;
  }

  const absolutePath = resolveLocalVoiceSamplePath(trimmedReference);
  if (!absolutePath) {
    return null;
  }

  try {
    return await fs.readFile(absolutePath);
  } catch (error) {
    log.warn(`[Voice Sample Storage] Failed to load local voice sample ${trimmedReference}`, error);
    return null;
  }
}

export async function deleteStoredVoiceSample(reference: string): Promise<boolean> {
  const target = reference.trim();
  if (!target) {
    return false;
  }

  if (/^https?:\/\//i.test(target)) {
    if (!IS_PRODUCTION) {
      return false;
    }

    const config = getVoiceSampleStorageConfig();
    if (!config) {
      return false;
    }

    const key = extractKeyFromVoiceSampleUrl(config, target);
    if (!key) {
      return false;
    }

    const client = getS3Client(config.region);

    try {
      await client.send(
        new DeleteObjectCommand({
          Bucket: config.bucket,
          Key: key,
        }),
      );
      log.info(`[Voice Sample Storage] Deleted voice sample object ${key}`);
      return true;
    } catch (error) {
      log.warn(`[Voice Sample Storage] Failed to delete voice sample object ${key}`, error);
      return false;
    }
  }

  const absolutePath = resolveLocalVoiceSamplePath(target);
  if (!absolutePath) {
    return false;
  }

  try {
    await fs.unlink(absolutePath);
    log.info(`[Voice Sample Storage] Deleted local voice sample ${normalizeStoredPath(target)}`);
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return false;
    }

    log.warn(`[Voice Sample Storage] Failed to delete local voice sample ${target}`, error);
    return false;
  }
}
