/**
 * Preset Import Utilities
 * Handles importing and validating TomoriBot personality data
 */

import { sql } from "@/utils/db/client";
import { log } from "../misc/logger";
import {
  PRESET_EXPORT_VERSION,
  presetExportDataSchema,
  presetExportSchema,
  type PresetExportData,
  type ImportResult,
  type ValidationResult,
} from "../../types/preset/presetExport";
import { validateTomoriConfigFields } from "./sqlSecurity";

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "23505"
  );
}

/**
 * Imports TomoriBot preset personality data, replacing existing personality
 * @param serverDiscId - Discord server ID to import preset for
 * @param importData - The validated preset export data to import
 * @param identityMode - preserve: keep/import lineage, fork: assign a fresh lineage
 * @returns ImportResult indicating success or failure with item counts
 */
export async function importPresetData(
  serverDiscId: string,
  importData: PresetExportData,
  identityMode: "preserve" | "fork" = "preserve",
): Promise<ImportResult> {
  try {
    const importValidation = validatePresetData(importData);
    if (!importValidation.valid || !importValidation.data) {
      return {
        success: false,
        error: importValidation.error ?? "commands.persona.import.error_invalid_format",
      };
    }
    const validatedImportData = importValidation.data;

    // 1. Validate trigger_words field for SQL security
    try {
      validateTomoriConfigFields(["trigger_words"]);
    } catch (error) {
      log.error("Config field validation failed during preset import:", error);
      return {
        success: false,
        error: "commands.persona.import.error_invalid_config",
      };
    }

    // 2. Get internal server ID and tomori ID (main persona only)
    const serverRows = await sql`
			SELECT s.server_id, t.tomori_id, t.persona_lineage_id
			FROM servers s
			JOIN tomoris t ON s.server_id = t.server_id
			WHERE s.server_disc_id = ${serverDiscId}
			AND t.is_alter = false
			LIMIT 1
		`;

    if (!serverRows.length) {
      return {
        success: false,
        error: "commands.persona.import.error_no_server_data",
      };
    }

    const serverId = serverRows[0].server_id;
    const mainTomoriId = serverRows[0].tomori_id;
    const importedLineageId = validatedImportData.persona_lineage_id ?? null;

    // 3. Enforce persona nickname uniqueness within this server (excluding current main persona)
    const conflictingNameRows = await sql<Array<{ tomori_id: number }>>`
			SELECT tomori_id
			FROM tomoris
			WHERE server_id = ${serverId}
			  AND tomori_id <> ${mainTomoriId}
			  AND lower(btrim(tomori_nickname)) = lower(btrim(${validatedImportData.tomori_nickname}))
			LIMIT 1
		`;
    if (conflictingNameRows.length > 0) {
      return {
        success: false,
        error: `commands.persona.import.error_name_conflict|${validatedImportData.tomori_nickname}`,
      };
    }

    // 4. Format arrays as PostgreSQL array literals for safe insertion
    const attributeArrayLiteral = `{${validatedImportData.attribute_list
      .map((item: string) => `"${item.replace(/(["\\])/g, "\\$1")}"`)
      .join(",")}}`;

    const dialoguesInArrayLiteral = `{${validatedImportData.sample_dialogues_in
      .map((item: string) => `"${item.replace(/(["\\])/g, "\\$1")}"`)
      .join(",")}}`;

    const dialoguesOutArrayLiteral = `{${validatedImportData.sample_dialogues_out
      .map((item: string) => `"${item.replace(/(["\\])/g, "\\$1")}"`)
      .join(",")}}`;

    const triggerWordsArrayLiteral = `{${validatedImportData.trigger_words
      .map((item: string) => `"${item.replace(/(["\\])/g, "\\$1")}"`)
      .join(",")}}`;
    const shouldUseImportedLineage = identityMode === "preserve" && importedLineageId !== null;

    // 5. Build NAI tags array literal for safe insertion
    const naiTagsArrayLiteral = `{${(validatedImportData.nai_tags ?? [])
      .map((item: string) => `"${item.replace(/(["\\])/g, "\\$1")}"`)
      .join(",")}}`;

    // 6. Update tomoris table with personality data, lineage behavior, and NovelAI fields
    try {
      await sql`
				UPDATE tomoris
				SET
					tomori_nickname = ${validatedImportData.tomori_nickname},
					attribute_list = ${attributeArrayLiteral}::text[],
					sample_dialogues_in = ${dialoguesInArrayLiteral}::text[],
					sample_dialogues_out = ${dialoguesOutArrayLiteral}::text[],
					persona_lineage_id = CASE
						WHEN ${identityMode} = 'fork' THEN nextval('persona_lineage_id_seq')
						WHEN ${shouldUseImportedLineage} THEN ${importedLineageId}::bigint
						ELSE persona_lineage_id
					END,
					nai_tags = ${naiTagsArrayLiteral}::text[],
					nai_char_ref_url = ${validatedImportData.nai_char_ref_url ?? null},
					nai_attg_author = ${validatedImportData.nai_attg_author ?? null},
					nai_attg_title = ${validatedImportData.nai_attg_title ?? null},
					nai_attg_tags = ${validatedImportData.nai_attg_tags ?? null},
					nai_attg_genre = ${validatedImportData.nai_attg_genre ?? null},
					nai_attg_stars = ${validatedImportData.nai_attg_stars ?? null}
				WHERE tomori_id = ${mainTomoriId}
			`;
    } catch (error) {
      if (isUniqueViolation(error)) {
        return {
          success: false,
          error: `commands.persona.import.error_name_conflict|${validatedImportData.tomori_nickname}`,
        };
      }
      throw error;
    }

    // 7. Update persona-scoped trigger words + optional persona prompt
    const importedPersonaPrompt =
      typeof validatedImportData.persona_prompt === "string" ? validatedImportData.persona_prompt : null;

    await sql`
			INSERT INTO persona_configs (tomori_id, trigger_words, persona_prompt)
			VALUES (
				${mainTomoriId},
				${triggerWordsArrayLiteral}::text[],
				${importedPersonaPrompt}
			)
			ON CONFLICT (tomori_id) DO UPDATE
			SET
				trigger_words = EXCLUDED.trigger_words,
				persona_prompt = EXCLUDED.persona_prompt
		`;

    await sql`
			UPDATE tomori_configs
			SET
				trigger_words = ${triggerWordsArrayLiteral}::text[]
			WHERE server_id = ${serverId}
		`;

    log.success(`Successfully imported preset for server ${serverDiscId}: ${validatedImportData.tomori_nickname}`);

    return {
      success: true,
      itemsImported: {
        nickname: validatedImportData.tomori_nickname,
        attributeCount: validatedImportData.attribute_list.length,
        dialogueCount: validatedImportData.sample_dialogues_in.length,
        triggerWordCount: validatedImportData.trigger_words.length,
      },
    };
  } catch (error) {
    log.error(`Error importing preset data for server ${serverDiscId}:`, error);
    return {
      success: false,
      error: "commands.persona.import.error_import_failed",
    };
  }
}

/**
 * Validates already-extracted preset data, including converted imports and command-added trigger words.
 * Runtime memory env limits are intentionally not applied here; preset import uses schema safety limits.
 */
export function validatePresetData(data: unknown): ValidationResult {
  const validated = presetExportDataSchema.safeParse(data);
  if (!validated.success) {
    log.error("Preset import data validation failed:", validated.error);
    return {
      valid: false,
      error: "commands.persona.import.error_invalid_format",
    };
  }

  if (validated.data.sample_dialogues_in.length !== validated.data.sample_dialogues_out.length) {
    return {
      valid: false,
      error: "commands.persona.import.error_dialogue_mismatch",
    };
  }

  return {
    valid: true,
    data: validated.data,
  };
}

/**
 * Validates and parses a preset import file
 * @param jsonData - The parsed JSON data from the PNG metadata
 * @returns Validation result with parsed data or error message
 */
export function validatePresetFile(jsonData: unknown): ValidationResult {
  // 1. Check if data is an object
  if (typeof jsonData !== "object" || jsonData === null) {
    return {
      valid: false,
      error: "commands.persona.import.error_not_json",
    };
  }

  // 2. Check version compatibility
  const version = (jsonData as { version?: string }).version;
  if (version !== PRESET_EXPORT_VERSION) {
    return {
      valid: false,
      error: `commands.persona.import.error_incompatible_version|${PRESET_EXPORT_VERSION}|${version || "unknown"}`,
    };
  }

  // 3. Check type field
  const type = (jsonData as { type?: string }).type;
  if (type !== "preset") {
    return {
      valid: false,
      error: `commands.persona.import.error_invalid_type|${type}`,
    };
  }

  // 4. Validate with Zod schema
  const validated = presetExportSchema.safeParse(jsonData);
  if (!validated.success) {
    log.error("Preset import validation failed:", validated.error);
    return {
      valid: false,
      error: "commands.persona.import.error_invalid_format",
    };
  }

  return validatePresetData(validated.data.data);
}
