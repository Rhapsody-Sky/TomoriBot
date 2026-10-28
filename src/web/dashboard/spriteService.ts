import { z } from "zod";
import { configSpriteOperations, loadPersonaSpriteList } from "@/utils/discord/interactions/configSpriteOperations";
import { PERSONA_SPRITE_LIMITS } from "@/utils/persona/sprites";
import { IMPORT_LIMITS, PERSONA_LIMITS, memoryGuard } from "@/utils/security/rateLimiter";
import { loadStoredPersonaAvatarBuffer } from "@/utils/storage/avatarStorage";
import { localizer } from "@/utils/text/localizer";
import { DashboardServiceError } from "./errors";
import type { DashboardGuildSnapshot } from "./types";

const metadataSchema = z
  .object({
    name: z.string().max(PERSONA_SPRITE_LIMITS.MAX_NAME_LENGTH),
    instructions: z.string().max(PERSONA_SPRITE_LIMITS.MAX_INSTRUCTIONS_LENGTH),
    identity: z.enum(["true", "false"]),
  })
  .strict();

export const SPRITE_UPLOAD_MAX_BYTES =
  Math.max(PERSONA_LIMITS.MAX_AVATAR_SIZE_MB, IMPORT_LIMITS.MAX_PERSONA_IMPORT_SIZE_MB) * 1024 * 1024;

function spriteError(code: string, status: 404 | 422 | 429 | 503 = 422): never {
  const keys: Record<string, string> = {
    "not-found": "missing",
    "invalid-name": "name",
    "duplicate-name": "duplicate",
    "instructions-too-long": "instructions",
    "invalid-image": "image",
    "conversion-failed": "image",
    "limit-reached": "limit",
    "quota-exceeded": "quota",
    "memory-critical": "memory",
    "invalid-file": "archive",
    "invalid-archive": "archive",
    "invalid-entry-name": "archive",
    "invalid-entry-image": "archive",
    "file-too-large": "size",
    "invalid-metadata": "metadata",
    "no-sprites": "empty",
    "all-images-failed": "images",
    "upload-failed": "storage",
    "write-failed": "write",
  };
  throw new DashboardServiceError(
    `sprite_${code}`,
    status,
    localizer("en-US", `general.dashboard.sprite_errors.${keys[code] || "failed"}`),
  );
}

function assertResult<T extends { status: string }>(result: T): Extract<T, { status: "success" }> {
  if (result.status !== "success")
    spriteError(
      result.status,
      result.status === "not-found"
        ? 404
        : result.status === "quota-exceeded"
          ? 429
          : ["write-failed", "upload-failed", "memory-critical"].includes(result.status)
            ? 503
            : 422,
    );
  return result as Extract<T, { status: "success" }>;
}

export class DashboardSpriteService {
  persona(snapshot: DashboardGuildSnapshot, personaId: number) {
    const persona = snapshot.rawPersonas.find((entry) => entry.persona_id === personaId);
    if (!persona) spriteError("not-found", 404);
    return persona;
  }

  async list(snapshot: DashboardGuildSnapshot, personaId: number) {
    const persona = this.persona(snapshot, personaId);
    const sprites = await loadPersonaSpriteList(personaId);
    return {
      inherited: persona.is_pointer === true,
      limits: {
        count: PERSONA_SPRITE_LIMITS.MAX_PER_PERSONA,
        name: PERSONA_SPRITE_LIMITS.MAX_NAME_LENGTH,
        instructions: PERSONA_SPRITE_LIMITS.MAX_INSTRUCTIONS_LENGTH,
        imageBytes: PERSONA_LIMITS.MAX_AVATAR_SIZE_MB * 1024 * 1024,
      },
      sprites: sprites.map((sprite) => ({
        key: sprite.sprite_key,
        name: sprite.sprite_name,
        instructions: sprite.usage_instructions,
        identity: sprite.is_identity,
        imageUrl: `/settings/api/guilds/${snapshot.serverDiscordId}/personas/${personaId}/sprites/image?key=${encodeURIComponent(sprite.sprite_key)}`,
      })),
    };
  }

  async save(
    snapshot: DashboardGuildSnapshot,
    personaId: number,
    currentKey: string | null,
    form: Record<string, unknown>,
  ) {
    const persona = this.persona(snapshot, personaId);
    if (Object.keys(form).some((key) => !["name", "instructions", "identity", "file"].includes(key)))
      spriteError("invalid-metadata");
    const parsed = metadataSchema.safeParse({
      name: form.name,
      instructions: form.instructions,
      identity: form.identity,
    });
    if (!parsed.success) spriteError("invalid-metadata");
    const attachment = form.file instanceof File && form.file.size > 0 ? form.file : null;
    if (form.file !== undefined && !(form.file instanceof File)) spriteError("invalid-image");
    if (attachment && attachment.size > PERSONA_LIMITS.MAX_AVATAR_SIZE_MB * 1024 * 1024) spriteError("file-too-large");
    const input = {
      persona,
      serverDiscId: snapshot.serverDiscordId,
      rawName: parsed.data.name,
      rawInstructions: parsed.data.instructions,
      isIdentity: parsed.data.identity === "true",
      attachment,
    };
    const result =
      currentKey === null
        ? await configSpriteOperations.addSprite(input)
        : await configSpriteOperations.editSprite({ ...input, currentSpriteKey: currentKey });
    if (result.status !== "no-changes") assertResult(result);
    return { message: localizer("en-US", "general.dashboard.sprite_saved") };
  }

  async remove(snapshot: DashboardGuildSnapshot, personaId: number, key: string) {
    const persona = this.persona(snapshot, personaId);
    if (!(await loadPersonaSpriteList(personaId)).some((sprite) => sprite.sprite_key === key))
      spriteError("not-found", 404);
    assertResult(
      await configSpriteOperations.removeSprite({ persona, serverDiscId: snapshot.serverDiscordId, spriteKey: key }),
    );
    return { message: localizer("en-US", "general.dashboard.sprite_removed") };
  }

  async import(snapshot: DashboardGuildSnapshot, personaId: number, actorDiscordId: string, file: unknown) {
    const persona = this.persona(snapshot, personaId);
    if (!(file instanceof File)) spriteError("invalid-file");
    const result = assertResult(
      await configSpriteOperations.importSprites({
        persona,
        serverDiscId: snapshot.serverDiscordId,
        quotaKey: actorDiscordId,
        attachment: file,
      }),
    );
    return {
      ...result,
      message: localizer("en-US", "general.dashboard.sprite_imported", {
        created: String(result.created),
        replaced: String(result.replaced),
        failed: String(result.failed),
      }),
    };
  }

  async export(snapshot: DashboardGuildSnapshot, personaId: number) {
    return assertResult(await configSpriteOperations.exportSprites({ persona: this.persona(snapshot, personaId) }));
  }

  async image(snapshot: DashboardGuildSnapshot, personaId: number, key: string) {
    this.persona(snapshot, personaId);
    const sprite = (await loadPersonaSpriteList(personaId)).find((entry) => entry.sprite_key === key);
    if (!sprite) spriteError("not-found", 404);
    if (memoryGuard.checkMemory().status === "critical") spriteError("memory-critical", 503);
    const buffer = await loadStoredPersonaAvatarBuffer(sprite.avatar_url);
    if (!buffer) spriteError("not-found", 404);
    return buffer;
  }
}
