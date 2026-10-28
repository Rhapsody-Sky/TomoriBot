import type { APIAttachment } from "discord.js";
import { PERSONA_LIMITS } from "@/utils/security/rateLimiter";
import { safeDownload } from "@/utils/security/safeDownload";

const DOWNLOAD_TIMEOUT_MS = 15000;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/gif"]);
const ALLOWED_IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif"]);

export type PersonaSpriteAttachment = APIAttachment | File;

export function personaSpriteAttachmentMetadata(attachment: PersonaSpriteAttachment) {
  return attachment instanceof File
    ? { filename: attachment.name, size: attachment.size, content_type: attachment.type }
    : attachment;
}

export type PersonaSpriteImageValidationResult =
  | { ok: true }
  | {
      ok: false;
      reason: "file_too_large" | "invalid_format";
    };

export function validatePersonaSpriteImageAttachment(
  input: PersonaSpriteAttachment,
): PersonaSpriteImageValidationResult {
  const attachment = personaSpriteAttachmentMetadata(input);
  const maxSizeBytes = PERSONA_LIMITS.MAX_AVATAR_SIZE_MB * 1024 * 1024;
  if (attachment.size > maxSizeBytes) {
    return { ok: false, reason: "file_too_large" };
  }

  const contentType = attachment.content_type?.toLowerCase();
  if (!contentType || !ALLOWED_IMAGE_TYPES.has(contentType)) {
    return { ok: false, reason: "invalid_format" };
  }

  const extension = attachment.filename.toLowerCase().split(".").pop();
  if (!extension || !ALLOWED_IMAGE_EXTENSIONS.has(extension)) {
    return { ok: false, reason: "invalid_format" };
  }

  return { ok: true };
}

export async function downloadPersonaSpriteImageAttachment(
  attachment: PersonaSpriteAttachment,
): Promise<{ ok: true; buffer: Buffer } | { ok: false; reason: "timeout" | "download_failed" }> {
  if (attachment instanceof File) {
    if (!validatePersonaSpriteImageAttachment(attachment).ok) return { ok: false, reason: "download_failed" };
    return { ok: true, buffer: Buffer.from(await attachment.arrayBuffer()) };
  }
  const downloadResult = await safeDownload(attachment.url, {
    maxSizeMB: PERSONA_LIMITS.MAX_AVATAR_SIZE_MB,
    timeoutMs: DOWNLOAD_TIMEOUT_MS,
    knownSize: attachment.size,
  });

  if (!downloadResult.success || !downloadResult.buffer) {
    return {
      ok: false,
      reason: downloadResult.error === "timeout" ? "timeout" : "download_failed",
    };
  }

  return {
    ok: true,
    buffer: downloadResult.buffer,
  };
}
