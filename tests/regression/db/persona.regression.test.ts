/**
 * Regression harness: PersonaRepository domain.
 *
 * Covers: loadTomoriState, loadAllPersonasForServer, loadPersonaConfigRow,
 * updateTomori.
 *
 * Requires: a local Postgres connection (see docs/en/contributing/testing/db-changes.md)
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { forkPointerForAvatarChange } from "@/utils/persona/pointerFork";
import type { TomoriPresetRow } from "@/types/db/schema";
import { configPersonaOperations } from "@/utils/discord/interactions/configPersonaOperations";
import { presetRepository, personaSpriteRepository, personaRepository } from "@/utils/db/repositories";
import { splitSqlStatements } from "@/utils/db/sqlSplitter";
import { FIXTURE_IDS, cleanupFixtures, insertFixtures, type FixtureRefs } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";
import { personaSpriteMessageRepository } from "@/utils/db/repositories/PersonaSpriteMessageRepository";
import { log } from "@/utils/misc/logger";

async function executeMigrationFile(fileName: string): Promise<void> {
  const sqlText = await readFile(join(import.meta.dir, "..", "..", "..", "src", "db", "migrations", fileName), "utf-8");
  for (const statement of splitSqlStatements(sqlText)) {
    await testSql.unsafe(statement);
  }
}

describe.skipIf(!DB_TESTS_AVAILABLE)("Persona — regression", () => {
  let refs: FixtureRefs;

  beforeAll(async () => {
    await setupTestDb();
    refs = await insertFixtures(testSql);
  });

  afterAll(async () => {
    await cleanupFixtures(testSql);
  });

  it("replaces bundle sprites and reference atomically and rolls them back when a staged voice disappears", async () => {
    const alter = await personaRepository.createAlterPersona({
      serverId: refs.serverId,
      nickname: "_rt_bundle",
      attributes: [],
      sampleDialoguesIn: [],
      sampleDialoguesOut: [],
    });
    if (!alter?.persona_id) throw new Error("Expected bundle target persona");
    const personaId = alter.persona_id;
    let sampleId: number | null = null;
    try {
      await personaRepository.setVoiceConfig(personaId, {
        speech_voice_sample_id: null,
        speech_voice_id: null,
        speech_voice_name: null,
        speech_voice_design_prompt: "Warm and quiet",
        voice_source_priority: "clone",
      });
      await personaRepository.setCharRef(personaId, "old-reference.png");
      await personaSpriteRepository.upsertSprite({
        personaId,
        spriteName: "old",
        spriteKey: "old",
        avatarUrl: "old.png",
        usageInstructions: "",
        isIdentity: false,
      });
      const input = {
        personaId,
        serverDiscId: FIXTURE_IDS.serverDiscId,
        charRefUrl: "new-reference.png",
        sprites: [
          {
            sprite_name: "happy",
            sprite_key: "happy",
            avatar_url: "new.png",
            usage_instructions: "When pleased",
            is_identity: true,
          },
        ],
        voice: { sampleId: 999999999, name: "Mirri" },
      };
      expect(await personaRepository.replaceBundleAssets(input)).toBe(false);
      expect((await personaSpriteRepository.listForPersona(personaId)).map((sprite) => sprite.sprite_key)).toEqual([
        "old",
      ]);
      const [unchanged] =
        await testSql`SELECT char_ref_url FROM persona_imagegen_configs WHERE persona_id = ${personaId}`;
      expect(unchanged.char_ref_url).toBe("old-reference.png");
      const [sample] =
        await testSql`INSERT INTO voice_samples (server_id, name, file_path, duration_ms) VALUES (${refs.serverId}, '_rt_bundle_voice', 'voice.wav', 1000) RETURNING sample_id`;
      sampleId = sample.sample_id as number;
      expect(await personaRepository.replaceBundleAssets({ ...input, voice: { sampleId, name: "Mirri" } })).toBe(true);
      const [voice] =
        await testSql`SELECT speech_voice_sample_id, voice_source_priority, speech_voice_design_prompt FROM persona_voice_configs WHERE persona_id = ${personaId}`;
      expect(voice.speech_voice_sample_id).toBe(sampleId);
      expect(voice.voice_source_priority).toBe("clone");
      expect(voice.speech_voice_design_prompt).not.toBeNull();
      expect((await personaSpriteRepository.listForPersona(personaId)).map((sprite) => sprite.sprite_key)).toEqual([
        "happy",
      ]);
      const [changed] =
        await testSql`SELECT char_ref_url FROM persona_imagegen_configs WHERE persona_id = ${personaId}`;
      expect(changed.char_ref_url).toBe("new-reference.png");
      expect(
        await personaRepository.replaceBundleAssets({ ...input, serverDiscId: "_rt_another_workspace", voice: null }),
      ).toBe(false);
    } finally {
      await personaRepository.removePersona(personaId);
      if (sampleId) await testSql`DELETE FROM voice_samples WHERE sample_id = ${sampleId}`;
    }
  });

  it("warns when a persona disappears before its sprite receipt and retains other write failures", async () => {
    const alter = await personaRepository.createAlterPersona({
      serverId: refs.serverId,
      nickname: "_rt_receipt",
      attributes: [],
      sampleDialoguesIn: [],
      sampleDialoguesOut: [],
    });
    if (!alter?.persona_id) throw new Error("Expected an alter persona");
    const input = {
      messageDiscId: "_rt_sprite_receipt",
      personaId: alter.persona_id,
      spriteName: "Happy",
      channelDiscId: "_rt_receipt_channel",
    };
    const errors = spyOn(log, "error").mockResolvedValue(undefined);
    const warnings = spyOn(log, "warn").mockImplementation(() => {});
    const metrics = spyOn(log, "metric").mockImplementation(() => {});
    try {
      expect(await personaSpriteMessageRepository.record(input)).toBe(true);
      expect(
        await personaSpriteMessageRepository.record({ ...input, messageDiscId: "_rt_invalid_receipt", spriteName: "" }),
      ).toBe(false);
      expect(errors).toHaveBeenCalledTimes(1);
      errors.mockClear();
      await testSql`DELETE FROM personas WHERE persona_id = ${alter.persona_id}`;
      expect(await personaSpriteMessageRepository.record(input)).toBe(false);
      expect(errors).not.toHaveBeenCalled();
      expect(warnings).toHaveBeenCalledTimes(1);
      expect(metrics).toHaveBeenCalledWith("persona_sprite_message_skipped", { reason: "persona_deleted" });
      expect(await personaSpriteMessageRepository.getByMessageIds([input.messageDiscId])).toEqual(new Map());
    } finally {
      errors.mockRestore();
      warnings.mockRestore();
      metrics.mockRestore();
      await testSql`DELETE FROM personas WHERE persona_id = ${alter.persona_id}`;
    }
  });

  it("loadTomoriState returns null for unknown server", async () => {
    const state = await personaRepository.loadState("_rt_unknown_server_9999");
    expect(state).toBeNull();
  });

  it("loadTomoriState assembles a valid TomoriState for the fixture server", async () => {
    const state = await personaRepository.loadState(FIXTURE_IDS.serverDiscId);
    expect(state).not.toBeNull();
    expect(state?.persona_id).toBe(refs.personaId);
    // Config should load the server-scoped row
    expect(state?.config).not.toBeNull();
    expect(state?.llm).not.toBeNull();
  });

  it("loadTomoriState includes a server_memories array for a fresh persona", async () => {
    const state = await personaRepository.loadState(FIXTURE_IDS.serverDiscId);
    expect(Array.isArray(state?.server_memories)).toBe(true);
  });

  it("loadTomoriState and loadAllPersonasForServer read persona config from split tables", async () => {
    try {
      await personaRepository.setContextNote(refs.personaId, "_rt_note_from_setter", 4);
      await personaRepository.setVoiceConfig(refs.personaId, {
        speech_voice_sample_id: null,
        speech_voice_id: "_rt_voice_from_setter",
        speech_voice_name: "_rt_voice_name_from_setter",
        voice_source_priority: "design",
        speech_voice_design_prompt: "_rt_voice_prompt_from_setter",
      });
      await personaRepository.setPhysicalAppearanceTags(refs.personaId, ["_rt_tag_from_setter"]);
      await personaRepository.setCharRef(refs.personaId, "_rt_ref_from_setter");
      await personaRepository.setNaiAttg(refs.personaId, {
        nai_attg_author: "_rt_author_from_setter",
        nai_attg_title: "_rt_title_from_setter",
        nai_attg_tags: "_rt_tags_from_setter",
        nai_attg_genre: "_rt_genre_from_setter",
        nai_attg_stars: 3,
      });

      await testSql`
        UPDATE persona_context_note_configs
        SET context_note = '_rt_note_from_split', context_note_depth = 9
        WHERE persona_id = ${refs.personaId}
      `;
      await testSql`
        UPDATE persona_voice_configs
        SET
          speech_voice_id = '_rt_voice_from_split',
          speech_voice_name = '_rt_voice_name_from_split',
          speech_voice_design_prompt = '_rt_voice_prompt_from_split'
        WHERE persona_id = ${refs.personaId}
      `;
      await testSql`
        UPDATE persona_imagegen_configs
        SET physical_appearance_tags = ARRAY['_rt_tag_from_split']::TEXT[], char_ref_url = '_rt_ref_from_split'
        WHERE persona_id = ${refs.personaId}
      `;
      await testSql`
        UPDATE persona_textgen_configs
        SET
          nai_attg_author = '_rt_author_from_split',
          nai_attg_title = '_rt_title_from_split',
          nai_attg_tags = '_rt_tags_from_split',
          nai_attg_genre = '_rt_genre_from_split',
          nai_attg_stars = 5
        WHERE persona_id = ${refs.personaId}
      `;

      const state = await personaRepository.loadState(FIXTURE_IDS.serverDiscId);
      expect(state?.context_note).toBe("_rt_note_from_split");
      expect(state?.context_note_depth).toBe(9);
      expect(state?.speech_voice_id).toBe("_rt_voice_from_split");
      expect(state?.speech_voice_name).toBe("_rt_voice_name_from_split");
      expect(state?.speech_voice_design_prompt).toBe("_rt_voice_prompt_from_split");
      expect(state?.physical_appearance_tags).toEqual(["_rt_tag_from_split"]);
      expect(state?.char_ref_url).toBe("_rt_ref_from_split");
      expect(state?.nai_attg_author).toBe("_rt_author_from_split");
      expect(state?.nai_attg_title).toBe("_rt_title_from_split");
      expect(state?.nai_attg_tags).toBe("_rt_tags_from_split");
      expect(state?.nai_attg_genre).toBe("_rt_genre_from_split");
      expect(state?.nai_attg_stars).toBe(5);

      const personas = await personaRepository.loadAllForServer(FIXTURE_IDS.serverDiscId);
      const loaded = personas.find((persona) => persona.persona_id === refs.personaId);
      expect(loaded?.context_note).toBe("_rt_note_from_split");
      expect(loaded?.speech_voice_id).toBe("_rt_voice_from_split");
      expect(loaded?.physical_appearance_tags).toEqual(["_rt_tag_from_split"]);
      expect(loaded?.nai_attg_author).toBe("_rt_author_from_split");
    } finally {
      await testSql`DELETE FROM persona_context_note_configs WHERE persona_id = ${refs.personaId}`;
      await testSql`DELETE FROM persona_voice_configs WHERE persona_id = ${refs.personaId}`;
      await testSql`DELETE FROM persona_imagegen_configs WHERE persona_id = ${refs.personaId}`;
      await testSql`DELETE FROM persona_textgen_configs WHERE persona_id = ${refs.personaId}`;
    }
  });

  it("loadTomoriState tolerates missing persona split rows", async () => {
    await testSql`DELETE FROM persona_context_note_configs WHERE persona_id = ${refs.personaId}`;
    await testSql`DELETE FROM persona_voice_configs WHERE persona_id = ${refs.personaId}`;
    await testSql`DELETE FROM persona_imagegen_configs WHERE persona_id = ${refs.personaId}`;
    await testSql`DELETE FROM persona_textgen_configs WHERE persona_id = ${refs.personaId}`;

    const state = await personaRepository.loadState(FIXTURE_IDS.serverDiscId);
    expect(state).not.toBeNull();
    expect(state?.context_note).toBeNull();
    expect(state?.context_note_depth).toBe(0);
    expect(state?.speech_voice_sample_id).toBeNull();
    expect(state?.speech_voice_id).toBeNull();
    expect(state?.speech_voice_name).toBeNull();
    expect(state?.speech_voice_design_prompt).toBeNull();
    expect(state?.physical_appearance_tags).toEqual([]);
    expect(state?.char_ref_url).toBeNull();
    expect(state?.nai_attg_author).toBeNull();
    expect(state?.nai_attg_stars).toBeNull();
  });

  it("createAlterPersona seeds persona imagegen and textgen split rows", async () => {
    const alterName = `_rt_split_seed_alter_${Date.now()}`;
    let alterPersonaId: number | null = null;

    try {
      const alter = await personaRepository.createAlterPersona({
        serverId: refs.serverId,
        nickname: alterName,
        attributes: ["_rt_seed_attr"],
        sampleDialoguesIn: ["_rt_seed_in"],
        sampleDialoguesOut: ["_rt_seed_out"],
        physicalAppearanceTags: ["_rt_seed_tag"],
        charRefUrl: "_rt_seed_ref",
        naiAttgAuthor: "_rt_seed_author",
        naiAttgTitle: "_rt_seed_title",
        naiAttgTags: "_rt_seed_tags",
        naiAttgGenre: "_rt_seed_genre",
        naiAttgStars: 4,
      });
      alterPersonaId = alter?.persona_id ?? null;
      expect(alterPersonaId).not.toBeNull();

      const [imagegenRow] = await testSql<Array<{ physical_appearance_tags: string[]; char_ref_url: string }>>`
        SELECT physical_appearance_tags, char_ref_url
        FROM persona_imagegen_configs
        WHERE persona_id = ${alterPersonaId}
      `;
      expect(imagegenRow.physical_appearance_tags).toEqual(["_rt_seed_tag"]);
      expect(imagegenRow.char_ref_url).toBe("_rt_seed_ref");

      const [textgenRow] = await testSql<Array<{ nai_attg_author: string; nai_attg_stars: number }>>`
        SELECT nai_attg_author, nai_attg_stars
        FROM persona_textgen_configs
        WHERE persona_id = ${alterPersonaId}
      `;
      expect(textgenRow.nai_attg_author).toBe("_rt_seed_author");
      expect(textgenRow.nai_attg_stars).toBe(4);

      const personas = await personaRepository.loadAllForServer(FIXTURE_IDS.serverDiscId);
      const loadedAlter = personas.find((persona) => persona.persona_id === alterPersonaId);
      expect(loadedAlter?.physical_appearance_tags).toEqual(["_rt_seed_tag"]);
      expect(loadedAlter?.char_ref_url).toBe("_rt_seed_ref");
      expect(loadedAlter?.nai_attg_author).toBe("_rt_seed_author");
      expect(loadedAlter?.nai_attg_stars).toBe(4);
    } finally {
      if (alterPersonaId !== null) {
        await testSql`DELETE FROM personas WHERE persona_id = ${alterPersonaId}`;
      } else {
        await testSql`DELETE FROM personas WHERE server_id = ${refs.serverId} AND persona_nickname = ${alterName}`;
      }
    }
  });

  it("migration 045 backfills missing split rows and lets mirror values win drift", async () => {
    let missingSplitPersonaId: number | null = null;

    try {
      await executeMigrationFile("125_rename_character_reference_columns.down.sql");
      await executeMigrationFile("046_drop_persona_mirror_columns.down.sql");

      const [missingSplitPersona] = await testSql<Array<{ persona_id: number }>>`
        INSERT INTO personas (server_id, persona_nickname, is_alter)
        VALUES (${refs.serverId}, '_rt_045_missing_split', true)
        RETURNING persona_id
      `;
      missingSplitPersonaId = missingSplitPersona.persona_id;

      await testSql`
        UPDATE personas
        SET
          context_note = '_rt_045_mirror_note',
          context_note_depth = 8,
          speech_voice_id = '_rt_045_mirror_voice',
          speech_voice_name = '_rt_045_mirror_voice_name',
          speech_voice_design_prompt = '_rt_045_mirror_prompt',
          physical_appearance_tags = ARRAY['_rt_045_mirror_tag']::TEXT[],
          nai_char_ref_url = '_rt_045_mirror_ref',
          nai_attg_author = '_rt_045_mirror_author',
          nai_attg_title = '_rt_045_mirror_title',
          nai_attg_tags = '_rt_045_mirror_tags',
          nai_attg_genre = '_rt_045_mirror_genre',
          nai_attg_stars = 2
        WHERE persona_id = ${refs.personaId}
      `;
      await testSql`
        INSERT INTO persona_context_note_configs (persona_id, context_note, context_note_depth)
        VALUES (${refs.personaId}, '_rt_045_old_note', 1)
        ON CONFLICT (persona_id) DO UPDATE SET
          context_note = EXCLUDED.context_note,
          context_note_depth = EXCLUDED.context_note_depth
      `;
      await testSql`
        INSERT INTO persona_voice_configs (
          persona_id, speech_voice_id, speech_voice_name, speech_voice_design_prompt
        )
        VALUES (${refs.personaId}, '_rt_045_old_voice', '_rt_045_old_voice_name', '_rt_045_old_prompt')
        ON CONFLICT (persona_id) DO UPDATE SET
          speech_voice_id = EXCLUDED.speech_voice_id,
          speech_voice_name = EXCLUDED.speech_voice_name,
          speech_voice_design_prompt = EXCLUDED.speech_voice_design_prompt
      `;
      await testSql`
        INSERT INTO persona_imagegen_configs (persona_id, physical_appearance_tags, nai_char_ref_url)
        VALUES (${refs.personaId}, ARRAY['_rt_045_old_tag']::TEXT[], '_rt_045_old_ref')
        ON CONFLICT (persona_id) DO UPDATE SET
          physical_appearance_tags = EXCLUDED.physical_appearance_tags,
          nai_char_ref_url = EXCLUDED.nai_char_ref_url
      `;
      await testSql`
        INSERT INTO persona_textgen_configs (
          persona_id, nai_attg_author, nai_attg_title, nai_attg_tags, nai_attg_genre, nai_attg_stars
        )
        VALUES (
          ${refs.personaId},
          '_rt_045_old_author',
          '_rt_045_old_title',
          '_rt_045_old_tags',
          '_rt_045_old_genre',
          1
        )
        ON CONFLICT (persona_id) DO UPDATE SET
          nai_attg_author = EXCLUDED.nai_attg_author,
          nai_attg_title = EXCLUDED.nai_attg_title,
          nai_attg_tags = EXCLUDED.nai_attg_tags,
          nai_attg_genre = EXCLUDED.nai_attg_genre,
          nai_attg_stars = EXCLUDED.nai_attg_stars
      `;

      await testSql`
        UPDATE personas
        SET
          context_note = '_rt_045_missing_note',
          context_note_depth = 6,
          physical_appearance_tags = ARRAY['_rt_045_missing_tag']::TEXT[],
          nai_attg_author = '_rt_045_missing_author'
        WHERE persona_id = ${missingSplitPersonaId}
      `;
      await testSql`DELETE FROM persona_context_note_configs WHERE persona_id = ${missingSplitPersonaId}`;
      await testSql`DELETE FROM persona_imagegen_configs WHERE persona_id = ${missingSplitPersonaId}`;
      await testSql`DELETE FROM persona_textgen_configs WHERE persona_id = ${missingSplitPersonaId}`;

      await executeMigrationFile("045_backfill_persona_split_configs.sql");

      const [contextRow] = await testSql<Array<{ context_note: string; context_note_depth: number }>>`
        SELECT context_note, context_note_depth
        FROM persona_context_note_configs
        WHERE persona_id = ${refs.personaId}
      `;
      expect(contextRow.context_note).toBe("_rt_045_mirror_note");
      expect(contextRow.context_note_depth).toBe(8);

      const [imageRow] = await testSql<Array<{ physical_appearance_tags: string[]; nai_char_ref_url: string }>>`
        SELECT physical_appearance_tags, nai_char_ref_url
        FROM persona_imagegen_configs
        WHERE persona_id = ${refs.personaId}
      `;
      expect(imageRow.physical_appearance_tags).toEqual(["_rt_045_mirror_tag"]);
      expect(imageRow.nai_char_ref_url).toBe("_rt_045_mirror_ref");

      const [voiceRow] = await testSql<Array<{ speech_voice_id: string; speech_voice_design_prompt: string }>>`
        SELECT speech_voice_id, speech_voice_design_prompt
        FROM persona_voice_configs
        WHERE persona_id = ${refs.personaId}
      `;
      expect(voiceRow.speech_voice_id).toBe("_rt_045_mirror_voice");
      expect(voiceRow.speech_voice_design_prompt).toBe("_rt_045_mirror_prompt");

      const [textRow] = await testSql<Array<{ nai_attg_author: string; nai_attg_stars: number }>>`
        SELECT nai_attg_author, nai_attg_stars
        FROM persona_textgen_configs
        WHERE persona_id = ${refs.personaId}
      `;
      expect(textRow.nai_attg_author).toBe("_rt_045_mirror_author");
      expect(textRow.nai_attg_stars).toBe(2);

      const [createdMissingRow] = await testSql<Array<{ context_note: string }>>`
        SELECT context_note
        FROM persona_context_note_configs
        WHERE persona_id = ${missingSplitPersonaId}
      `;
      expect(createdMissingRow.context_note).toBe("_rt_045_missing_note");
    } finally {
      if (missingSplitPersonaId !== null) {
        await testSql`DELETE FROM personas WHERE persona_id = ${missingSplitPersonaId}`;
      }
      await executeMigrationFile("046_drop_persona_mirror_columns.sql");
      await executeMigrationFile("125_rename_character_reference_columns.sql");
      await testSql`DELETE FROM persona_context_note_configs WHERE persona_id = ${refs.personaId}`;
      await testSql`DELETE FROM persona_voice_configs WHERE persona_id = ${refs.personaId}`;
      await testSql`DELETE FROM persona_imagegen_configs WHERE persona_id = ${refs.personaId}`;
      await testSql`DELETE FROM persona_textgen_configs WHERE persona_id = ${refs.personaId}`;
    }
  });

  it("migration 046 rollback restores mirror columns from split tables", async () => {
    try {
      await executeMigrationFile("046_drop_persona_mirror_columns.sql");
      await personaRepository.setContextNote(refs.personaId, "_rt_046_note", 7);
      await personaRepository.setVoiceConfig(refs.personaId, {
        speech_voice_sample_id: null,
        speech_voice_id: "_rt_046_voice",
        speech_voice_name: "_rt_046_voice_name",
        voice_source_priority: "design",
        speech_voice_design_prompt: "_rt_046_prompt",
      });
      await personaRepository.setPhysicalAppearanceTags(refs.personaId, ["_rt_046_tag"]);
      await personaRepository.setCharRef(refs.personaId, "_rt_046_ref");
      await personaRepository.setNaiAttg(refs.personaId, {
        nai_attg_author: "_rt_046_author",
        nai_attg_title: "_rt_046_title",
        nai_attg_tags: "_rt_046_tags",
        nai_attg_genre: "_rt_046_genre",
        nai_attg_stars: 5,
      });

      await executeMigrationFile("125_rename_character_reference_columns.down.sql");
      await executeMigrationFile("046_drop_persona_mirror_columns.down.sql");

      const [row] = await testSql<
        Array<{
          context_note: string;
          context_note_depth: number;
          speech_voice_id: string;
          speech_voice_design_prompt: string;
          physical_appearance_tags: string[];
          nai_char_ref_url: string;
          nai_attg_author: string;
          nai_attg_stars: number;
        }>
      >`
        SELECT
          context_note,
          context_note_depth,
          speech_voice_id,
          speech_voice_design_prompt,
          physical_appearance_tags,
          nai_char_ref_url,
          nai_attg_author,
          nai_attg_stars
        FROM personas
        WHERE persona_id = ${refs.personaId}
      `;

      expect(row.context_note).toBe("_rt_046_note");
      expect(row.context_note_depth).toBe(7);
      expect(row.speech_voice_id).toBe("_rt_046_voice");
      expect(row.speech_voice_design_prompt).toBe("_rt_046_prompt");
      expect(row.physical_appearance_tags).toEqual(["_rt_046_tag"]);
      expect(row.nai_char_ref_url).toBe("_rt_046_ref");
      expect(row.nai_attg_author).toBe("_rt_046_author");
      expect(row.nai_attg_stars).toBe(5);
    } finally {
      await executeMigrationFile("046_drop_persona_mirror_columns.sql");
      await executeMigrationFile("125_rename_character_reference_columns.sql");
      await testSql`DELETE FROM persona_context_note_configs WHERE persona_id = ${refs.personaId}`;
      await testSql`DELETE FROM persona_voice_configs WHERE persona_id = ${refs.personaId}`;
      await testSql`DELETE FROM persona_imagegen_configs WHERE persona_id = ${refs.personaId}`;
      await testSql`DELETE FROM persona_textgen_configs WHERE persona_id = ${refs.personaId}`;
    }
  });

  it("persona config export/import round-trips through split tables", async () => {
    try {
      await personaRepository.setContextNote(refs.personaId, "_rt_export_note", 3);
      await personaRepository.setVoiceConfig(refs.personaId, {
        speech_voice_sample_id: null,
        speech_voice_id: "_rt_export_voice",
        speech_voice_name: "_rt_export_voice_name",
        voice_source_priority: "design",
        speech_voice_design_prompt: "_rt_export_prompt",
      });
      await personaRepository.setPhysicalAppearanceTags(refs.personaId, ["_rt_export_tag"]);
      await personaRepository.setCharRef(refs.personaId, "_rt_export_ref");
      await personaRepository.setNaiAttg(refs.personaId, {
        nai_attg_author: "_rt_export_author",
        nai_attg_title: "_rt_export_title",
        nai_attg_tags: "_rt_export_tags",
        nai_attg_genre: "_rt_export_genre",
        nai_attg_stars: 4,
      });

      const exported = await personaRepository.toExportShape(FIXTURE_IDS.serverDiscId);
      expect(exported).not.toBeNull();
      if (!exported) {
        throw new Error("Expected persona export shape for fixture server.");
      }

      await testSql`
        UPDATE persona_context_note_configs
        SET context_note = '_rt_export_mutated', context_note_depth = 1
        WHERE persona_id = ${refs.personaId}
      `;
      await testSql`
        UPDATE persona_voice_configs
        SET speech_voice_id = '_rt_export_mutated_voice'
        WHERE persona_id = ${refs.personaId}
      `;
      await testSql`
        UPDATE persona_imagegen_configs
        SET physical_appearance_tags = ARRAY['_rt_export_mutated_tag']::TEXT[]
        WHERE persona_id = ${refs.personaId}
      `;
      await testSql`
        UPDATE persona_textgen_configs
        SET nai_attg_author = '_rt_export_mutated_author'
        WHERE persona_id = ${refs.personaId}
      `;

      expect(await personaRepository.fromExportShape(FIXTURE_IDS.serverDiscId, exported)).toBe(true);

      const state = await personaRepository.loadState(FIXTURE_IDS.serverDiscId);
      expect(state?.context_note).toBe("_rt_export_note");
      expect(state?.context_note_depth).toBe(3);
      expect(state?.speech_voice_id).toBe("_rt_export_voice");
      expect(state?.physical_appearance_tags).toEqual(["_rt_export_tag"]);
      expect(state?.nai_attg_author).toBe("_rt_export_author");
    } finally {
      await testSql`DELETE FROM persona_context_note_configs WHERE persona_id = ${refs.personaId}`;
      await testSql`DELETE FROM persona_voice_configs WHERE persona_id = ${refs.personaId}`;
      await testSql`DELETE FROM persona_imagegen_configs WHERE persona_id = ${refs.personaId}`;
      await testSql`DELETE FROM persona_textgen_configs WHERE persona_id = ${refs.personaId}`;
    }
  });

  it("loadAllPersonasForServer returns at least the main persona", async () => {
    const personas = await personaRepository.loadAllForServer(FIXTURE_IDS.serverDiscId);
    expect(personas.length).toBeGreaterThanOrEqual(1);
    const mainPersona = personas.find((p) => !p.is_alter);
    expect(mainPersona).not.toBeUndefined();
    expect(mainPersona?.persona_id).toBe(refs.personaId);
  });

  it("loadAllPersonasForServer returns empty array for unknown server", async () => {
    const personas = await personaRepository.loadAllForServer("_rt_unknown_server_9999");
    expect(personas).toHaveLength(0);
  });

  it("swapPersona promotes the alter row without mixing persona details", async () => {
    const alterName = `_rt_swap_alter_${Date.now()}`;
    const mainAttribute = "_rt_main_attr";
    const alterAttribute = "_rt_alter_attr";
    let alterPersonaId: number | null = null;

    await testSql`
      UPDATE personas
      SET
        attribute_list = ARRAY[${mainAttribute}]::TEXT[],
        sample_dialogues_in = ARRAY['_rt_main_in']::TEXT[],
        sample_dialogues_out = ARRAY['_rt_main_out']::TEXT[]
      WHERE persona_id = ${refs.personaId}
    `;

    const [alterRow] = await testSql<Array<{ persona_id: number }>>`
      INSERT INTO personas (
        server_id,
        persona_nickname,
        attribute_list,
        sample_dialogues_in,
        sample_dialogues_out,
        is_alter
      )
      VALUES (
        ${refs.serverId},
        ${alterName},
        ARRAY[${alterAttribute}]::TEXT[],
        ARRAY['_rt_alter_in']::TEXT[],
        ARRAY['_rt_alter_out']::TEXT[],
        true
      )
      RETURNING persona_id
    `;
    alterPersonaId = alterRow.persona_id;

    try {
      const swapped = await personaRepository.swapPersona(refs.personaId, alterPersonaId);
      expect(swapped).toBe("swapped");
      // Replaying the same swap is the double-click shape: expected, so it must not read as a failure.
      expect(await personaRepository.swapPersona(refs.personaId, alterPersonaId)).toBe("roles-changed");

      const personas = await personaRepository.loadAllForServer(FIXTURE_IDS.serverDiscId);
      const promotedAlter = personas.find((persona) => persona.persona_id === alterPersonaId);
      const formerMain = personas.find((persona) => persona.persona_id === refs.personaId);

      expect(promotedAlter?.is_alter).toBe(false);
      expect(promotedAlter?.persona_nickname).toBe(alterName);
      expect(promotedAlter?.attribute_list).toContain(alterAttribute);
      expect(promotedAlter?.sample_dialogues_in).toContain("_rt_alter_in");
      expect(promotedAlter?.sample_dialogues_out).toContain("_rt_alter_out");

      expect(formerMain?.is_alter).toBe(true);
      expect(formerMain?.persona_nickname).toBe("_rt_persona");
      expect(formerMain?.attribute_list).toContain(mainAttribute);
      expect(formerMain?.sample_dialogues_in).toContain("_rt_main_in");
      expect(formerMain?.sample_dialogues_out).toContain("_rt_main_out");
    } finally {
      if (alterPersonaId !== null) {
        await personaRepository.swapPersona(alterPersonaId, refs.personaId);
        await testSql`DELETE FROM personas WHERE persona_id = ${alterPersonaId}`;
      }

      await testSql`
        UPDATE personas
        SET
          attribute_list = ARRAY[]::TEXT[],
          sample_dialogues_in = ARRAY[]::TEXT[],
          sample_dialogues_out = ARRAY[]::TEXT[]
        WHERE persona_id = ${refs.personaId}
      `;
    }
  });

  it("replaceCharacterFromCard overwrites character data while preserving persona identity", async () => {
    const targetName = `_rt_replace_target_${Date.now()}`;
    const serverMemoryContent = `_rt_replace_server_memory_${Date.now()}`;
    const personalMemoryContent = `_rt_replace_personal_memory_${Date.now()}`;
    let targetPersonaId: number | null = null;
    let savedConfigId: number | null = null;

    const [targetRow] = await testSql<
      Array<{ persona_id: number; persona_lineage_id: number | string; preset_lineage_id: number }>
    >`
      INSERT INTO personas (
        server_id,
        persona_nickname,
        attribute_list,
        sample_dialogues_in,
        sample_dialogues_out,
        webhook_avatar_url,
        is_alter,
        preset_lineage_id,
        preset_language
      )
      VALUES (
        ${refs.serverId},
        ${targetName},
        ARRAY['_rt_replace_target_attribute']::TEXT[],
        ARRAY['_rt_replace_target_input']::TEXT[],
        ARRAY['_rt_replace_target_output']::TEXT[],
        '_rt_preserved_avatar',
        true,
        900_200,
        'en-US'
      )
      RETURNING persona_id, persona_lineage_id, preset_lineage_id
    `;
    targetPersonaId = targetRow.persona_id;
    const targetLineageId = Number(targetRow.persona_lineage_id);

    await testSql`
      INSERT INTO persona_configs (
        persona_id, trigger_words, persona_prompt,
        reward_conditioning_enabled, punish_conditioning_enabled, humanizer_degree
      )
      VALUES (
        ${targetPersonaId}, ARRAY['_rt_old_trigger']::TEXT[], '_rt_old_prompt',
        false, false, 3
      )
    `;
    await testSql`
      INSERT INTO server_memories (server_id, persona_id, persona_lineage_id, user_id, content)
      VALUES (${refs.serverId}, ${targetPersonaId}, ${targetLineageId}, ${refs.userId}, ${serverMemoryContent})
    `;
    await testSql`
      INSERT INTO personal_memories (user_id, persona_lineage_id, content)
      VALUES (${refs.userId}, ${targetLineageId}, ${personalMemoryContent})
    `;
    await testSql`
      INSERT INTO persona_context_note_configs (persona_id, context_note, context_note_depth)
      VALUES (${targetPersonaId}, '_rt_preserved_context', 7)
    `;
    await testSql`
      INSERT INTO persona_sprites (persona_id, sprite_name, sprite_key, avatar_url)
      VALUES (${targetPersonaId}, 'Old Sprite', 'old-sprite', '_rt_old_sprite_url')
    `;
    await testSql`
      INSERT INTO persona_natural_nudge_configs (
        persona_id, talkativeness, interests, authored_idle_nudges, disabled_idle_nudge_ids
      ) VALUES (
        ${targetPersonaId},
        0,
        '[{"label":"Old interest","description":"Old description"}]'::jsonb,
        '[{"id":"old-id","category":"start_topic","title":"Old idle","brief":"Old brief","agenda_hint":null,"prerequisites":[],"recommended_tools":[]}]'::jsonb,
        '["old-id"]'::jsonb
      )
    `;
    await testSql`
      INSERT INTO persona_naming_configs (persona_id, prefixes, suffixes, address_terms)
      VALUES (
        ${targetPersonaId},
        '{"neutral":"Old"}'::jsonb,
        '{}'::jsonb,
        '{"neutral":"old friend"}'::jsonb
      )
    `;
    await personaRepository.setVoiceConfig(targetPersonaId, {
      speech_voice_sample_id: null,
      speech_voice_id: "_rt_old_voice_id",
      speech_voice_name: "Old voice",
      speech_voice_design_prompt: "Old voice design",
      voice_source_priority: "clone",
    });
    const [savedConfig] = await testSql<Array<{ saved_config_id: number }>>`
      INSERT INTO saved_provider_configs (server_id, provider)
      VALUES (${refs.serverId}, ${`_rt_replace_google_${Date.now()}`})
      RETURNING saved_config_id
    `;
    savedConfigId = savedConfig.saved_config_id;
    await testSql`
      INSERT INTO speech_voice_bindings (
        persona_id, saved_config_id, credential_revision, transport, prompt_hash, voice_id
      ) VALUES (${targetPersonaId}, ${savedConfigId}, 1, 'google', '_rt_old_voice_hash', '_rt_old_google_voice')
    `;

    try {
      const result = await personaRepository.replaceCharacterFromCard({
        personaId: targetPersonaId,
        serverId: refs.serverId,
        card: {
          tomori_nickname: "_rt_replacement_character",
          attribute_list: ["_rt_replacement_private", "_rt_replacement_public"],
          attribute_public_flags: [false, true],
          sample_dialogues_in: ["_rt_replacement_input"],
          sample_dialogues_out: ["_rt_replacement_output"],
          trigger_words: ["_rt_replacement_trigger"],
          persona_prompt: "_rt_replacement_prompt",
          persona_lineage_id: 999_999,
          preset_lineage_id: 900_201,
          is_nsfw: true,
          naming_config: {
            prefixes: { neutral: "New" },
            suffixes: {},
            addressTerms: { neutral: "new friend" },
          },
          speech_voice_design_prompt: "_rt_replacement_voice_design",
          voice_source_priority: "clone",
          natural_nudge_talkativeness: 4,
          natural_nudge_interests: [{ label: "New interest", description: "New description" }],
          natural_nudge_idle_nudges: [
            {
              id: "new-id",
              category: "start_topic",
              title: "New idle",
              brief: "New brief",
              agenda_hint: null,
              prerequisites: [],
              recommended_tools: [],
            },
          ],
          physical_appearance_tags: ["_rt_replacement_tag"],
          char_ref_url: "_rt_replacement_reference",
          nai_attg_author: "_rt_replacement_author",
          nai_attg_title: "_rt_replacement_title",
          nai_attg_tags: "_rt_replacement_tags",
          nai_attg_genre: "_rt_replacement_genre",
          nai_attg_stars: 4,
        },
      });
      expect(result).toEqual({
        personaId: targetPersonaId,
        personaLineageId: targetLineageId,
        wasMain: false,
        previousAvatarUrl: "_rt_preserved_avatar",
      });

      const [sourceAfter] = await testSql<Array<{ is_alter: boolean }>>`
        SELECT is_alter FROM personas WHERE persona_id = ${refs.personaId}
      `;
      const [targetAfter] = await testSql<
        Array<{
          is_alter: boolean;
          persona_lineage_id: number | string;
          preset_lineage_id: number | string | null;
          preset_language: string | null;
          is_nsfw: boolean;
          attribute_list: string[];
          webhook_avatar_url: string | null;
          persona_prompt: string | null;
          trigger_words: string[];
          reward_conditioning_enabled: boolean;
          punish_conditioning_enabled: boolean;
          humanizer_degree: number | null;
        }>
      >`
        SELECT
          p.is_alter,
          p.persona_lineage_id,
          p.preset_lineage_id,
          p.preset_language,
          p.is_nsfw,
          p.attribute_list,
          p.webhook_avatar_url,
          pc.persona_prompt,
          pc.trigger_words,
          pc.reward_conditioning_enabled,
          pc.punish_conditioning_enabled,
          pc.humanizer_degree
        FROM personas p
        JOIN persona_configs pc ON pc.persona_id = p.persona_id
        WHERE p.persona_id = ${targetPersonaId}
      `;
      expect(sourceAfter.is_alter).toBe(false);
      expect(targetAfter.is_alter).toBe(true);
      expect(Number(targetAfter.persona_lineage_id)).toBe(targetLineageId);
      expect(Number(targetAfter.preset_lineage_id)).toBe(900_201);
      expect(targetAfter.preset_language).toBeNull();
      expect(targetAfter.is_nsfw).toBe(true);
      expect(targetAfter.attribute_list).toEqual(["_rt_replacement_private", "_rt_replacement_public"]);
      expect(targetAfter.webhook_avatar_url).toBe("_rt_preserved_avatar");
      expect(targetAfter.persona_prompt).toBe("_rt_replacement_prompt");
      expect(targetAfter.trigger_words).toEqual(["_rt_replacement_trigger"]);
      expect(targetAfter.reward_conditioning_enabled).toBe(false);
      expect(targetAfter.punish_conditioning_enabled).toBe(false);
      expect(targetAfter.humanizer_degree).toBe(3);

      const attributes = await testSql<Array<{ attribute_text: string; is_public: boolean }>>`
        SELECT attribute_text, is_public
        FROM persona_attributes
        WHERE persona_id = ${targetPersonaId}
        ORDER BY attribute_order
      `;
      expect(attributes).toEqual([
        { attribute_text: "_rt_replacement_private", is_public: false },
        { attribute_text: "_rt_replacement_public", is_public: true },
      ]);

      const [operationalConfig] = await testSql<Array<{ context_note: string; context_note_depth: number }>>`
        SELECT context_note, context_note_depth
        FROM persona_context_note_configs
        WHERE persona_id = ${targetPersonaId}
      `;
      expect(operationalConfig).toEqual({ context_note: "_rt_preserved_context", context_note_depth: 7 });

      const [spriteCount] = await testSql<Array<{ count: number | string }>>`
        SELECT COUNT(*)::INT AS count FROM persona_sprites WHERE persona_id = ${targetPersonaId}
      `;
      expect(Number(spriteCount.count)).toBe(0);

      const [characterConfigs] = await testSql<
        Array<{
          physical_appearance_tags: string[];
          char_ref_url: string | null;
          nai_attg_author: string | null;
          nai_attg_title: string | null;
          nai_attg_tags: string | null;
          nai_attg_genre: string | null;
          nai_attg_stars: number | null;
        }>
      >`
        SELECT
          pic.physical_appearance_tags,
          pic.char_ref_url,
          ptc.nai_attg_author,
          ptc.nai_attg_title,
          ptc.nai_attg_tags,
          ptc.nai_attg_genre,
          ptc.nai_attg_stars
        FROM persona_imagegen_configs pic
        JOIN persona_textgen_configs ptc ON ptc.persona_id = pic.persona_id
        WHERE pic.persona_id = ${targetPersonaId}
      `;
      expect(characterConfigs).toEqual({
        physical_appearance_tags: ["_rt_replacement_tag"],
        char_ref_url: "_rt_replacement_reference",
        nai_attg_author: "_rt_replacement_author",
        nai_attg_title: "_rt_replacement_title",
        nai_attg_tags: "_rt_replacement_tags",
        nai_attg_genre: "_rt_replacement_genre",
        nai_attg_stars: 4,
      });

      const [voiceConfig] = await testSql`
        SELECT speech_voice_sample_id, speech_voice_id, speech_voice_name,
          speech_voice_design_prompt, voice_source_priority
        FROM persona_voice_configs WHERE persona_id = ${targetPersonaId}
      `;
      expect(voiceConfig).toEqual({
        speech_voice_sample_id: null,
        speech_voice_id: null,
        speech_voice_name: null,
        speech_voice_design_prompt: "_rt_replacement_voice_design",
        voice_source_priority: "clone",
      });

      const [nudgeConfig] = await testSql`
        SELECT talkativeness, interests, authored_idle_nudges, disabled_idle_nudge_ids
        FROM persona_natural_nudge_configs WHERE persona_id = ${targetPersonaId}
      `;
      expect(nudgeConfig).toEqual({
        talkativeness: 4,
        interests: [{ label: "New interest", description: "New description" }],
        authored_idle_nudges: [
          {
            id: "new-id",
            category: "start_topic",
            title: "New idle",
            brief: "New brief",
            agenda_hint: null,
            prerequisites: [],
            recommended_tools: [],
          },
        ],
        disabled_idle_nudge_ids: [],
      });

      const [namingConfig] = await testSql`
        SELECT prefixes, suffixes, address_terms
        FROM persona_naming_configs WHERE persona_id = ${targetPersonaId}
      `;
      expect(namingConfig).toEqual({
        prefixes: { neutral: "New" },
        suffixes: {},
        address_terms: { neutral: "new friend" },
      });

      const [binding] = await testSql`
        SELECT pending_delete FROM speech_voice_bindings
        WHERE persona_id = ${targetPersonaId} AND saved_config_id = ${savedConfigId}
      `;
      expect(binding.pending_delete).toBe(true);

      const [serverMemory] = await testSql<Array<{ persona_id: number; persona_lineage_id: number | string }>>`
        SELECT persona_id, persona_lineage_id
        FROM server_memories
        WHERE content = ${serverMemoryContent}
      `;
      expect(serverMemory.persona_id).toBe(targetPersonaId);
      expect(Number(serverMemory.persona_lineage_id)).toBe(targetLineageId);

      const [personalMemory] = await testSql<Array<{ persona_lineage_id: number | string }>>`
        SELECT persona_lineage_id
        FROM personal_memories
        WHERE content = ${personalMemoryContent}
      `;
      expect(Number(personalMemory.persona_lineage_id)).toBe(targetLineageId);
    } finally {
      await testSql`DELETE FROM server_memories WHERE content = ${serverMemoryContent}`;
      await testSql`DELETE FROM personal_memories WHERE content = ${personalMemoryContent}`;
      if (savedConfigId !== null) {
        await testSql`DELETE FROM saved_provider_configs WHERE saved_config_id = ${savedConfigId}`;
      }
      if (targetPersonaId !== null) {
        await testSql`DELETE FROM personas WHERE persona_id = ${targetPersonaId}`;
      }
    }
  });

  it("replaceCharacterConfig resets character-scoped settings before applying a preset pointer", async () => {
    const suffix = Date.now();
    const presetName = `_rt_replace_config_preset_${suffix}`;
    const memoryContent = `_rt_replace_config_memory_${suffix}`;
    const presetNamingConfig = {
      prefixes: { neutral: "Preset" },
      suffixes: {},
      addressTerms: { neutral: "friend" },
    };
    let personaId: number | null = null;
    let savedConfigId: number | null = null;

    const [preset] = await testSql<TomoriPresetRow[]>`
      INSERT INTO persona_presets (
        persona_preset_name, persona_preset_desc, preset_lineage_id, preset_language,
        preset_attribute_list, preset_attribute_public_flags, preset_sample_dialogues_in,
        preset_sample_dialogues_out, preset_trigger_words, preset_naming_config
      ) VALUES (
        ${presetName}, '_rt_replace_config_prompt', ${900_300 + (suffix % 1000)}, 'en-US',
        ARRAY['_rt_replace_config_attribute']::TEXT[], ARRAY[false]::BOOLEAN[],
        ARRAY['_rt_replace_config_input']::TEXT[], ARRAY['_rt_replace_config_output']::TEXT[],
        ARRAY['_rt_replace_config_trigger']::TEXT[], ${JSON.stringify(presetNamingConfig)}::jsonb
      ) RETURNING *
    `;
    const persona = await personaRepository.createAlterPersona({
      serverId: refs.serverId,
      nickname: `_rt_replace_config_persona_${suffix}`,
      attributes: ["_rt_old_config_attribute"],
      sampleDialoguesIn: [],
      sampleDialoguesOut: [],
    });
    if (!persona?.persona_id) throw new Error("Could not create preset replacement fixture");
    personaId = persona.persona_id;
    const personaLineageId = Number(persona.persona_lineage_id);

    try {
      expect(await personaRepository.setPhysicalAppearanceTags(personaId, ["_rt_old_config_tag"])).toBe(true);
      expect(await personaRepository.setCharRef(personaId, "_rt_old_config_reference")).toBe(true);
      expect(
        await personaRepository.setNaiAttg(personaId, {
          nai_attg_author: "_rt_old_config_author",
          nai_attg_title: "_rt_old_config_title",
          nai_attg_tags: "_rt_old_config_tags",
          nai_attg_genre: "_rt_old_config_genre",
          nai_attg_stars: 3,
        }),
      ).toBe(true);
      expect(
        await personaRepository.setVoiceConfig(personaId, {
          speech_voice_sample_id: null,
          speech_voice_id: "_rt_old_config_voice_id",
          speech_voice_name: "Old voice",
          speech_voice_design_prompt: "_rt_old_config_voice_prompt",
          voice_source_priority: "clone",
        }),
      ).toBe(true);
      expect(
        await personaRepository.updateNamingConfig(personaId, {
          prefixes: { neutral: "Old" },
          suffixes: {},
          addressTerms: { neutral: "old friend" },
        }),
      ).toBe(true);
      await testSql`
        INSERT INTO persona_natural_nudge_configs (
          persona_id, talkativeness, interests, authored_idle_nudges, disabled_idle_nudge_ids
        ) VALUES (
          ${personaId}, 4, '[{"label":"Old","description":"Old interest"}]'::jsonb,
          '[{"id":"old-id","category":"start_topic","title":"Old idle","brief":"Old brief","agenda_hint":null,"prerequisites":[],"recommended_tools":[]}]'::jsonb,
          '["old-id"]'::jsonb
        )
      `;
      const [savedConfig] = await testSql<Array<{ saved_config_id: number }>>`
        INSERT INTO saved_provider_configs (server_id, provider)
        VALUES (${refs.serverId}, ${`_rt_replace_pointer_google_${suffix}`})
        RETURNING saved_config_id
      `;
      savedConfigId = savedConfig.saved_config_id;
      await testSql`
        INSERT INTO speech_voice_bindings (
          persona_id, saved_config_id, credential_revision, transport, prompt_hash, voice_id
        ) VALUES (${personaId}, ${savedConfigId}, 1, 'google', '_rt_old_config_voice_hash', '_rt_old_config_google_voice')
      `;
      const [memory] = await testSql`
        INSERT INTO server_memories (server_id, persona_id, persona_lineage_id, user_id, content)
        VALUES (${refs.serverId}, ${personaId}, ${personaLineageId}, ${refs.userId}, ${memoryContent})
        RETURNING server_memory_id
      `;

      const applied = await personaRepository.applyPresetPointerToPersona({
        personaId,
        nickname: `_rt_replaced_with_${presetName}`,
        preset,
        personaLineageId,
        expectedServerId: refs.serverId,
        expectedLineageId: personaLineageId,
        replaceCharacterConfig: true,
      });
      expect(applied?.is_pointer).toBe(true);
      expect(Number(applied?.persona_lineage_id)).toBe(personaLineageId);

      const [characterConfigs] = await testSql`
        SELECT pic.physical_appearance_tags, pic.char_ref_url,
          ptc.nai_attg_author, ptc.nai_attg_title, ptc.nai_attg_tags, ptc.nai_attg_genre, ptc.nai_attg_stars
        FROM persona_imagegen_configs pic
        JOIN persona_textgen_configs ptc ON ptc.persona_id = pic.persona_id
        WHERE pic.persona_id = ${personaId}
      `;
      expect(characterConfigs).toEqual({
        physical_appearance_tags: [],
        char_ref_url: null,
        nai_attg_author: null,
        nai_attg_title: null,
        nai_attg_tags: null,
        nai_attg_genre: null,
        nai_attg_stars: null,
      });
      const [voiceConfig] = await testSql`
        SELECT speech_voice_sample_id, speech_voice_id, speech_voice_name,
          speech_voice_design_prompt, voice_source_priority
        FROM persona_voice_configs WHERE persona_id = ${personaId}
      `;
      expect(voiceConfig).toEqual({
        speech_voice_sample_id: null,
        speech_voice_id: null,
        speech_voice_name: null,
        speech_voice_design_prompt: null,
        voice_source_priority: "design",
      });
      const [namingConfig] = await testSql`
        SELECT prefixes, suffixes, address_terms
        FROM persona_naming_configs WHERE persona_id = ${personaId}
      `;
      expect(namingConfig).toEqual({
        prefixes: { neutral: "Preset" },
        suffixes: {},
        address_terms: { neutral: "friend" },
      });
      const [nudgeConfigCount] = await testSql`
        SELECT COUNT(*)::int AS count FROM persona_natural_nudge_configs WHERE persona_id = ${personaId}
      `;
      expect(nudgeConfigCount.count).toBe(0);
      const [binding] = await testSql`
        SELECT pending_delete FROM speech_voice_bindings
        WHERE persona_id = ${personaId} AND saved_config_id = ${savedConfigId}
      `;
      expect(binding.pending_delete).toBe(true);
      const [keptMemory] = await testSql`
        SELECT persona_id, persona_lineage_id FROM server_memories WHERE server_memory_id = ${memory.server_memory_id}
      `;
      expect(keptMemory).toEqual({ persona_id: personaId, persona_lineage_id: personaLineageId });
    } finally {
      await testSql`DELETE FROM server_memories WHERE content = ${memoryContent}`;
      if (savedConfigId !== null) {
        await testSql`DELETE FROM saved_provider_configs WHERE saved_config_id = ${savedConfigId}`;
      }
      if (personaId !== null) {
        await testSql`DELETE FROM personas WHERE persona_id = ${personaId}`;
      }
      await testSql`DELETE FROM persona_presets WHERE persona_preset_name = ${presetName}`;
    }
  });

  it("replaceCharacterFromCard leaves direct assignments attached to the same persona", async () => {
    const suffix = Date.now();
    const sourceName = `_rt_replace_assignment_source_${suffix}`;
    const targetName = `_rt_replace_assignment_control_${suffix}`;
    const channelDiscId = `_rt_replace_channel_${suffix}`;
    const blockedUserDiscId = `_rt_replace_user_${suffix}`;
    const serverMemoryContent = `_rt_replace_assignment_memory_${suffix}`;
    let sourcePersonaId: number | null = null;
    let targetPersonaId: number | null = null;

    const createdRows = await testSql<
      Array<{ persona_id: number; persona_lineage_id: number | string; persona_nickname: string }>
    >`
      INSERT INTO personas (server_id, persona_nickname, is_alter)
      VALUES
        (${refs.serverId}, ${sourceName}, true),
        (${refs.serverId}, ${targetName}, true)
      RETURNING persona_id, persona_lineage_id, persona_nickname
    `;
    const sourceRow = createdRows.find((row) => row.persona_nickname === sourceName);
    const targetRow = createdRows.find((row) => row.persona_nickname === targetName);
    expect(sourceRow).toBeDefined();
    expect(targetRow).toBeDefined();
    if (!sourceRow || !targetRow) return;

    sourcePersonaId = sourceRow.persona_id;
    targetPersonaId = targetRow.persona_id;

    await testSql`
      INSERT INTO server_memories (server_id, persona_id, persona_lineage_id, user_id, content)
      VALUES (
        ${refs.serverId},
        ${sourcePersonaId},
        ${Number(sourceRow.persona_lineage_id)},
        ${refs.userId},
        ${serverMemoryContent}
      )
    `;
    await testSql`
      INSERT INTO channel_persona_whitelist (server_id, channel_disc_id, persona_id)
      VALUES (${refs.serverId}, ${channelDiscId}, ${sourcePersonaId})
    `;
    await testSql`
      INSERT INTO persona_user_blocks (
        server_id, persona_id, user_disc_id, block_type, reason, expires_at
      )
      VALUES (
        ${refs.serverId},
        ${sourcePersonaId},
        ${blockedUserDiscId},
        'block',
        'replacement regression test',
        NOW() + INTERVAL '1 day'
      )
    `;

    try {
      const result = await personaRepository.replaceCharacterFromCard({
        personaId: sourcePersonaId,
        serverId: refs.serverId,
        card: {
          tomori_nickname: "_rt_replaced_source_character",
          attribute_list: [],
          sample_dialogues_in: [],
          sample_dialogues_out: [],
          trigger_words: ["_rt_replaced_source_trigger"],
          persona_prompt: "_rt_replaced_source_prompt",
        },
      });
      expect(result).toEqual({
        personaId: sourcePersonaId,
        personaLineageId: Number(sourceRow.persona_lineage_id),
        wasMain: false,
        previousAvatarUrl: null,
      });

      const [sourceAfter] = await testSql<
        Array<{ persona_nickname: string; persona_lineage_id: number | string; is_alter: boolean }>
      >`
        SELECT persona_nickname, persona_lineage_id, is_alter
        FROM personas
        WHERE persona_id = ${sourcePersonaId}
      `;
      expect(sourceAfter.persona_nickname).toBe("_rt_replaced_source_character");
      expect(Number(sourceAfter.persona_lineage_id)).toBe(Number(sourceRow.persona_lineage_id));
      expect(sourceAfter.is_alter).toBe(true);

      const [targetAfter] = await testSql<Array<{ persona_lineage_id: number | string }>>`
        SELECT persona_lineage_id FROM personas WHERE persona_id = ${targetPersonaId}
      `;
      expect(Number(targetAfter.persona_lineage_id)).toBe(Number(targetRow.persona_lineage_id));

      const [serverMemory] = await testSql<Array<{ persona_id: number; persona_lineage_id: number | string }>>`
        SELECT persona_id, persona_lineage_id
        FROM server_memories
        WHERE content = ${serverMemoryContent}
      `;
      expect(serverMemory.persona_id).toBe(sourcePersonaId);
      expect(Number(serverMemory.persona_lineage_id)).toBe(Number(sourceRow.persona_lineage_id));

      const [whitelistEntry] = await testSql<Array<{ persona_id: number }>>`
        SELECT persona_id
        FROM channel_persona_whitelist
        WHERE server_id = ${refs.serverId} AND channel_disc_id = ${channelDiscId}
      `;
      expect(whitelistEntry.persona_id).toBe(sourcePersonaId);

      const [blockEntry] = await testSql<Array<{ persona_id: number }>>`
        SELECT persona_id
        FROM persona_user_blocks
        WHERE server_id = ${refs.serverId} AND user_disc_id = ${blockedUserDiscId}
      `;
      expect(blockEntry.persona_id).toBe(sourcePersonaId);
    } finally {
      await testSql`DELETE FROM server_memories WHERE content = ${serverMemoryContent}`;
      if (sourcePersonaId !== null) {
        await testSql`DELETE FROM personas WHERE persona_id = ${sourcePersonaId}`;
      }
      if (targetPersonaId !== null) {
        await testSql`DELETE FROM personas WHERE persona_id = ${targetPersonaId}`;
      }
    }
  });

  it("addSampleDialoguePair appends TEXT[] dialogue arrays", async () => {
    await testSql`
      UPDATE personas
      SET
        sample_dialogues_in = ARRAY[]::TEXT[],
        sample_dialogues_out = ARRAY[]::TEXT[]
      WHERE persona_id = ${refs.personaId}
    `;

    const added = await personaRepository.addSampleDialoguePair(refs.personaId, ["_rt_added_in"], ["_rt_added_out"]);
    expect(added).toBe(true);

    const [row] = await testSql<Array<{ sample_dialogues_in: string[]; sample_dialogues_out: string[] }>>`
      SELECT sample_dialogues_in, sample_dialogues_out
      FROM personas
      WHERE persona_id = ${refs.personaId}
    `;

    expect(row.sample_dialogues_in).toEqual(["_rt_added_in"]);
    expect(row.sample_dialogues_out).toEqual(["_rt_added_out"]);
  });

  it("attribute helpers keep persona_attributes and attribute_list mirrored", async () => {
    try {
      expect(
        await personaRepository.replaceAttributes(refs.personaId, ["_rt_private", "_rt_public"], [false, true]),
      ).toBe(true);

      let personas = await personaRepository.loadAllForServer(FIXTURE_IDS.serverDiscId);
      let persona = personas.find((item) => item.persona_id === refs.personaId);
      expect(persona?.attribute_list).toEqual(["_rt_private", "_rt_public"]);
      expect(persona?.persona_attributes.map((attribute) => attribute.is_public)).toEqual([false, true]);

      expect(await personaRepository.addAttributes(refs.personaId, ["_rt_added_public"], true)).toBe(true);
      expect(await personaRepository.editAttributeAt(refs.personaId, 1, "_rt_private_edited", true)).toBe(true);
      expect(await personaRepository.removeAttributeAt(refs.personaId, 2)).toBe(true);

      personas = await personaRepository.loadAllForServer(FIXTURE_IDS.serverDiscId);
      persona = personas.find((item) => item.persona_id === refs.personaId);
      expect(persona?.attribute_list).toEqual(["_rt_private_edited", "_rt_added_public"]);
      expect(persona?.persona_attributes.map((attribute) => attribute.is_public)).toEqual([true, true]);

      const [mirrorRow] = await testSql<Array<{ attribute_list: string[] }>>`
        SELECT attribute_list
        FROM personas
        WHERE persona_id = ${refs.personaId}
      `;
      expect(mirrorRow.attribute_list).toEqual(["_rt_private_edited", "_rt_added_public"]);
    } finally {
      await personaRepository.replaceAttributes(refs.personaId, []);
    }
  });

  it("preset pointers resolve live preset content and fork on first content edit", async () => {
    const presetLineageId = 900_001;
    const presetName = "_rt_pointer_preset";

    try {
      const [preset] = await testSql`
        INSERT INTO persona_presets (
          persona_preset_name,
          persona_preset_desc,
          preset_lineage_id,
          preset_attribute_list,
          preset_attribute_public_flags,
          preset_sample_dialogues_in,
          preset_sample_dialogues_out,
          preset_language,
          preset_trigger_words,
          preset_avatar_path
        )
        VALUES (
          ${presetName},
          '_rt_pointer_prompt_v1',
          ${presetLineageId},
          ARRAY['_rt_pointer_attr_v1']::TEXT[],
          ARRAY[true]::BOOLEAN[],
          ARRAY['_rt_pointer_in_v1']::TEXT[],
          ARRAY['_rt_pointer_out_v1']::TEXT[],
          'en-US',
          ARRAY['_rt_pointer_trigger_v1']::TEXT[],
          NULL
        )
        ON CONFLICT (persona_preset_name) DO UPDATE SET
          persona_preset_desc = EXCLUDED.persona_preset_desc,
          preset_lineage_id = EXCLUDED.preset_lineage_id,
          preset_attribute_list = EXCLUDED.preset_attribute_list,
          preset_attribute_public_flags = EXCLUDED.preset_attribute_public_flags,
          preset_sample_dialogues_in = EXCLUDED.preset_sample_dialogues_in,
          preset_sample_dialogues_out = EXCLUDED.preset_sample_dialogues_out,
          preset_language = EXCLUDED.preset_language,
          preset_trigger_words = EXCLUDED.preset_trigger_words
        RETURNING *
      `;

      const applied = await personaRepository.applyPresetPointerToPersona({
        personaId: refs.personaId,
        nickname: "_rt_pointer_persona",
        preset,
        personaLineageId: refs.personaLineageId,
      });
      expect(applied?.is_pointer).toBe(true);
      expect(Number(applied?.persona_lineage_id)).toBe(refs.personaLineageId);

      await testSql`
        UPDATE persona_presets
        SET
          persona_preset_desc = '_rt_pointer_prompt_v2',
          preset_attribute_list = ARRAY['_rt_pointer_attr_v2']::TEXT[],
          preset_attribute_public_flags = ARRAY[false]::BOOLEAN[],
          preset_sample_dialogues_in = ARRAY['_rt_pointer_in_v2']::TEXT[],
          preset_sample_dialogues_out = ARRAY['_rt_pointer_out_v2']::TEXT[],
          preset_trigger_words = ARRAY['_rt_pointer_trigger_v2']::TEXT[]
        WHERE persona_preset_name = ${presetName}
      `;

      let personas = await personaRepository.loadAllForServer(FIXTURE_IDS.serverDiscId);
      let persona = personas.find((item) => item.persona_id === refs.personaId);
      expect(persona?.is_pointer).toBe(true);
      expect(persona?.attribute_list).toEqual(["_rt_pointer_attr_v2"]);
      expect(persona?.persona_attributes.map((attribute) => attribute.is_public)).toEqual([false]);
      expect(persona?.sample_dialogues_in).toEqual(["_rt_pointer_in_v2"]);
      expect(persona?.trigger_words).toEqual(["_rt_pointer_trigger_v2"]);
      expect(persona?.persona_prompt).toBe("_rt_pointer_prompt_v2");

      expect(await personaRepository.addAttributes(refs.personaId, ["_rt_after_fork"], false)).toBe(true);

      const [forkedRow] = await testSql<Array<{ is_pointer: boolean; persona_lineage_id: number | string | bigint }>>`
        SELECT is_pointer, persona_lineage_id
        FROM personas
        WHERE persona_id = ${refs.personaId}
      `;
      expect(forkedRow.is_pointer).toBe(false);
      expect(Number(forkedRow.persona_lineage_id)).toBe(refs.personaLineageId);

      await testSql`
        UPDATE persona_presets
        SET preset_attribute_list = ARRAY['_rt_pointer_attr_v3']::TEXT[]
        WHERE persona_preset_name = ${presetName}
      `;

      personas = await personaRepository.loadAllForServer(FIXTURE_IDS.serverDiscId);
      persona = personas.find((item) => item.persona_id === refs.personaId);
      expect(persona?.attribute_list).toEqual(["_rt_pointer_attr_v2", "_rt_after_fork"]);
    } finally {
      await testSql`
        UPDATE personas
        SET
          persona_nickname = '_rt_persona',
          attribute_list = ARRAY[]::TEXT[],
          sample_dialogues_in = ARRAY[]::TEXT[],
          sample_dialogues_out = ARRAY[]::TEXT[],
          is_pointer = false,
          preset_lineage_id = NULL,
          preset_language = NULL
        WHERE persona_id = ${refs.personaId}
      `;
      await testSql`DELETE FROM persona_attributes WHERE persona_id = ${refs.personaId}`;
      await testSql`
        INSERT INTO persona_configs (persona_id, trigger_words, persona_prompt)
        VALUES (${refs.personaId}, ARRAY['_rt_trigger']::TEXT[], NULL)
        ON CONFLICT (persona_id) DO UPDATE SET
          trigger_words = EXCLUDED.trigger_words,
          persona_prompt = EXCLUDED.persona_prompt
      `;
      await testSql`DELETE FROM persona_presets WHERE persona_preset_name = ${presetName}`;
    }
  });

  it("/server avatar materializes a pointer persona before avatar customization", async () => {
    const presetLineageId = 900_002;
    const personaLineageId = 900_102;
    const presetName = "_rt_avatar_pointer_preset";
    const alterName = `_rt_avatar_pointer_alter_${Date.now()}`;
    let alterPersonaId: number | null = null;

    try {
      const [preset] = await testSql`
        INSERT INTO persona_presets (
          persona_preset_name,
          persona_preset_desc,
          preset_lineage_id,
          preset_attribute_list,
          preset_attribute_public_flags,
          preset_sample_dialogues_in,
          preset_sample_dialogues_out,
          preset_language,
          preset_trigger_words,
          preset_avatar_path
        )
        VALUES (
          ${presetName},
          '_rt_avatar_pointer_prompt',
          ${presetLineageId},
          ARRAY['_rt_avatar_pointer_attr']::TEXT[],
          ARRAY[true]::BOOLEAN[],
          ARRAY['_rt_avatar_pointer_in']::TEXT[],
          ARRAY['_rt_avatar_pointer_out']::TEXT[],
          'en-US',
          ARRAY['_rt_avatar_pointer_trigger']::TEXT[],
          NULL
        )
        ON CONFLICT (persona_preset_name) DO UPDATE SET
          persona_preset_desc = EXCLUDED.persona_preset_desc,
          preset_lineage_id = EXCLUDED.preset_lineage_id,
          preset_attribute_list = EXCLUDED.preset_attribute_list,
          preset_attribute_public_flags = EXCLUDED.preset_attribute_public_flags,
          preset_sample_dialogues_in = EXCLUDED.preset_sample_dialogues_in,
          preset_sample_dialogues_out = EXCLUDED.preset_sample_dialogues_out,
          preset_language = EXCLUDED.preset_language,
          preset_trigger_words = EXCLUDED.preset_trigger_words
        RETURNING *
      `;

      const alter = await personaRepository.createPresetPointerAlterPersona({
        serverId: refs.serverId,
        nickname: alterName,
        preset,
        personaLineageId,
      });
      alterPersonaId = alter?.persona_id ?? null;
      expect(alterPersonaId).not.toBeNull();
      expect(alter?.is_pointer).toBe(true);

      const personas = await personaRepository.loadAllForServer(FIXTURE_IDS.serverDiscId);
      const selectedPersona = personas.find((item) => item.persona_id === alterPersonaId);
      expect(selectedPersona?.is_pointer).toBe(true);
      if (!selectedPersona || alterPersonaId === null) {
        throw new Error("Expected pointer alter persona to exist before avatar update.");
      }

      expect(await forkPointerForAvatarChange(selectedPersona)).toBe(true);
      expect(await personaRepository.setAvatar(alterPersonaId, "_rt_avatar_pointer_url")).toBe(true);

      const [forkedRow] = await testSql<
        Array<{ is_pointer: boolean; persona_lineage_id: number | string | bigint; webhook_avatar_url: string | null }>
      >`
        SELECT is_pointer, persona_lineage_id, webhook_avatar_url
        FROM personas
        WHERE persona_id = ${alterPersonaId}
      `;

      expect(forkedRow.is_pointer).toBe(false);
      expect(Number(forkedRow.persona_lineage_id)).toBe(personaLineageId);
      expect(forkedRow.webhook_avatar_url).toBe("_rt_avatar_pointer_url");
    } finally {
      if (alterPersonaId !== null) {
        await testSql`DELETE FROM personas WHERE persona_id = ${alterPersonaId}`;
      } else {
        await testSql`DELETE FROM personas WHERE server_id = ${refs.serverId} AND persona_nickname = ${alterName}`;
      }
      await testSql`DELETE FROM persona_presets WHERE persona_preset_name = ${presetName}`;
    }
  });

  it("preset character references resolve live, freeze on fork, and clear on avatar change or re-point", async () => {
    const presetLineageId = 900_003;
    const presetName = "_rt_char_ref_pointer_preset";
    const alterName = `_rt_char_ref_pointer_alter_${Date.now()}`;
    const presetRef = (version: string) => `data/avatars/presets/${presetLineageId}/character-reference-${version}.png`;
    let alterPersonaId: number | null = null;

    const loadCharRef = async () => {
      const personas = await personaRepository.loadAllForServer(FIXTURE_IDS.serverDiscId);
      return personas.find((item) => item.persona_id === alterPersonaId)?.char_ref_url ?? null;
    };
    const setPresetRef = (version: string) => testSql`
      UPDATE persona_presets SET preset_char_ref_shared_url = ${presetRef(version)}
      WHERE persona_preset_name = ${presetName}
    `;

    try {
      const [preset] = await testSql<TomoriPresetRow[]>`
        INSERT INTO persona_presets (
          persona_preset_name, persona_preset_desc, preset_lineage_id, preset_language, preset_char_ref_shared_url
        )
        VALUES (${presetName}, '_rt_char_ref_prompt', ${presetLineageId}, 'en-US', ${presetRef("v1")})
        ON CONFLICT (persona_preset_name) DO UPDATE SET
          preset_lineage_id = EXCLUDED.preset_lineage_id,
          preset_char_ref_shared_url = EXCLUDED.preset_char_ref_shared_url
        RETURNING *
      `;
      const alter = await personaRepository.createPresetPointerAlterPersona({
        serverId: refs.serverId,
        nickname: alterName,
        preset,
        personaLineageId: presetLineageId,
      });
      alterPersonaId = alter?.persona_id ?? null;
      if (alterPersonaId === null) throw new Error("Expected pointer alter persona to exist.");
      expect(await loadCharRef()).toBe(presetRef("v1"));

      await setPresetRef("v2");
      expect(await loadCharRef()).toBe(presetRef("v2"));

      expect(await personaRepository.materializeIfPointer(alterPersonaId)).toBe(true);
      await setPresetRef("v3");
      expect(await loadCharRef()).toBe(presetRef("v2"));

      expect(await personaRepository.clearPresetCharRef(alterPersonaId)).toBe(true);
      expect(await loadCharRef()).toBeNull();

      const ownRef = `data/charreferences/personas/${alterPersonaId}/own.png`;
      expect(await personaRepository.setCharRef(alterPersonaId, ownRef)).toBe(true);
      expect(await personaRepository.clearPresetCharRef(alterPersonaId)).toBe(false);
      expect(await loadCharRef()).toBe(ownRef);

      const [currentPreset] = await testSql<TomoriPresetRow[]>`
        SELECT * FROM persona_presets WHERE persona_preset_name = ${presetName}
      `;
      await personaRepository.applyPresetPointerToPersona({
        personaId: alterPersonaId,
        nickname: alterName,
        preset: currentPreset,
      });
      expect(await loadCharRef()).toBe(presetRef("v3"));
    } finally {
      if (alterPersonaId !== null) {
        await testSql`DELETE FROM personas WHERE persona_id = ${alterPersonaId}`;
      } else {
        await testSql`DELETE FROM personas WHERE server_id = ${refs.serverId} AND persona_nickname = ${alterName}`;
      }
      await testSql`DELETE FROM persona_presets WHERE persona_preset_name = ${presetName}`;
    }
  });

  it("loadPersonaConfigRow returns the fixture persona_config row", async () => {
    const config = await personaRepository.loadPersonaConfig(refs.personaId);
    expect(config).not.toBeNull();
    expect(config?.persona_id).toBe(refs.personaId);
    expect(config?.trigger_words).toContain("_rt_trigger");
  });

  it("loadPersonaConfigRow returns null for unknown persona", async () => {
    const config = await personaRepository.loadPersonaConfig(999_999_999);
    expect(config).toBeNull();
  });

  it("trigger config writes strip surrounding quote characters", async () => {
    const originalConfig = await personaRepository.loadPersonaConfig(refs.personaId);
    const originalTriggers = [...(originalConfig?.trigger_words ?? [])];

    try {
      const added = await personaRepository.addTrigger(refs.personaId, [
        '"_rt_quoted_trigger"',
        "`_rt_quoted_trigger`",
        "'_rt_second_quoted_trigger'",
      ]);
      expect(added).toBe(true);

      const config = await personaRepository.loadPersonaConfig(refs.personaId);
      expect(config?.trigger_words).toContain("_rt_quoted_trigger");
      expect(config?.trigger_words).toContain("_rt_second_quoted_trigger");
      expect(config?.trigger_words).not.toContain('"_rt_quoted_trigger"');
      expect(config?.trigger_words).not.toContain("`_rt_quoted_trigger`");
    } finally {
      await personaRepository.removeTrigger(refs.personaId, originalTriggers);
    }
  });

  it("updateTomori mutates the nickname and returns the updated row", async () => {
    const updated = await personaRepository.update(refs.personaId, { persona_nickname: "_rt_persona_renamed" });
    expect(updated).not.toBeNull();
    expect(updated?.persona_nickname).toBe("_rt_persona_renamed");
  });

  it("loadAllPersonasForServer reflects the nickname change", async () => {
    const personas = await personaRepository.loadAllForServer(FIXTURE_IDS.serverDiscId);
    const main = personas.find((p) => p.persona_id === refs.personaId);
    expect(main?.persona_nickname).toBe("_rt_persona_renamed");
  });
  it("resyncs main and alter presets without moving lineage, memories, or identity settings", async () => {
    const presetLineageId = 900_105;
    const [preset] = await testSql<TomoriPresetRow[]>`
      INSERT INTO persona_presets (
        persona_preset_name, persona_preset_desc, preset_lineage_id, preset_attribute_list,
        preset_attribute_public_flags, preset_sample_dialogues_in, preset_sample_dialogues_out,
        preset_language, preset_trigger_words
      ) VALUES (
        '_rt_resync_preset', '_rt_preset_prompt', ${presetLineageId}, ARRAY['_rt_preset_attribute']::TEXT[],
        ARRAY[true]::BOOLEAN[], ARRAY['_rt_input']::TEXT[], ARRAY['_rt_output']::TEXT[],
        'en-US', ARRAY['_rt_preset_trigger']::TEXT[]
      ) RETURNING *
    `;
    const alter = await personaRepository.createAlterPersona({
      serverId: refs.serverId,
      nickname: "_rt_resync_alter",
      attributes: [],
      sampleDialoguesIn: [],
      sampleDialoguesOut: [],
    });
    if (!alter?.persona_id) throw new Error("Could not create the resync alter fixture");
    try {
      for (const personaId of [refs.personaId, alter.persona_id]) {
        const [before] = await testSql`SELECT persona_lineage_id FROM personas WHERE persona_id = ${personaId}`;
        const lineageId = Number(before.persona_lineage_id);
        expect(lineageId).not.toBe(presetLineageId);
        await personaRepository.applyPresetPointerToPersona({
          personaId,
          nickname: `_rt_resync_${personaId}`,
          preset,
          personaLineageId: lineageId,
        });
        await personaRepository.addAttributes(personaId, ["_rt_local_attribute"], false);
        await personaRepository.removeTrigger(personaId, [`_rt_local_${personaId}`, `_rt_second_${personaId}`]);
        const naming = { prefixes: { neutral: "Dear" }, suffixes: {}, addressTerms: { neutral: "friend" } };
        await personaRepository.updateNamingConfig(personaId, naming);
        await personaRepository.setContextNote(personaId, "_rt_keep_note", 4);
        await personaSpriteRepository.upsertSprite({
          personaId,
          spriteName: "Extra",
          spriteKey: "extra",
          avatarUrl: "data/avatars/presets/900105/sprites/extra-hash.png",
          usageInstructions: "",
          isIdentity: false,
        });
        await testSql`UPDATE personas SET applied_avatar_hash = 'old-hash' WHERE persona_id = ${personaId}`;
        const [memory] = await testSql`
          INSERT INTO server_memories (server_id, persona_id, persona_lineage_id, user_id, content)
          VALUES (${refs.serverId}, ${personaId}, ${lineageId}, ${refs.userId}, '_rt_keep_memory') RETURNING *
        `;
        const persona = (await personaRepository.loadAllForServer(FIXTURE_IDS.serverDiscId)).find(
          (item) => item.persona_id === personaId,
        );
        if (!persona) throw new Error("Missing persona in resync fixture");
        const result = await configPersonaOperations.resyncToPreset({
          persona,
          preset,
          serverDiscId: FIXTURE_IDS.serverDiscId,
          guildIdentity: null,
        });
        expect(result.status).toBe("success");
        const [stored] = await testSql`SELECT * FROM personas WHERE persona_id = ${personaId}`;
        expect(Number(stored.persona_lineage_id)).toBe(lineageId);
        expect(stored.is_pointer).toBe(true);
        expect(stored.applied_avatar_hash).toBeNull();
        const sprites = await testSql`SELECT * FROM persona_sprites WHERE persona_id = ${personaId}`;
        expect(sprites).toHaveLength(0);
        const [keptMemory] =
          await testSql`SELECT * FROM server_memories WHERE server_memory_id = ${memory.server_memory_id}`;
        expect(keptMemory).toEqual(memory);
        const resolved = (await personaRepository.loadAllForServer(FIXTURE_IDS.serverDiscId)).find(
          (item) => item.persona_id === personaId,
        );
        if (!resolved) throw new Error("Missing persona in resync fixture");
        expect(resolved.attribute_list).toEqual(preset.preset_attribute_list);
        expect(resolved.sample_dialogues_out).toEqual(preset.preset_sample_dialogues_out);
        expect(resolved.trigger_words).toEqual(persona.trigger_words);
        expect(resolved.naming_config).toEqual(naming);
        expect(resolved.context_note).toBe("_rt_keep_note");
        const exported = await presetRepository.exportPresetData(FIXTURE_IDS.serverDiscId, personaId);
        expect(exported.success).toBe(true);
        if (exported.success) {
          expect(exported.data.data.trigger_words).toEqual(persona.trigger_words);
          expect(exported.data.data.naming_config).toEqual(naming);
        }
        if (!resolved.is_alter) {
          const main = await personaRepository.loadState(FIXTURE_IDS.serverDiscId);
          expect(main?.trigger_words).toEqual(persona.trigger_words);
          expect(main?.naming_config).toEqual(naming);
        }
        await personaRepository.addAttributes(personaId, ["_rt_fork_again"], false);
        const forked = (await personaRepository.loadAllForServer(FIXTURE_IDS.serverDiscId)).find(
          (item) => item.persona_id === personaId,
        );
        if (!forked) throw new Error("Missing persona in resync fixture");
        expect(forked.is_pointer).toBe(false);
        expect(forked.trigger_words).toEqual(persona.trigger_words);
        expect(forked.naming_config).toEqual(naming);
      }
    } finally {
      if (alter?.persona_id) await testSql`DELETE FROM personas WHERE persona_id = ${alter.persona_id}`;
      await testSql`DELETE FROM persona_presets WHERE preset_lineage_id = ${presetLineageId}`;
    }
  });
});
