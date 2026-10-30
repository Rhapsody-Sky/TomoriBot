import type { PresetExportData } from "@/types/preset/presetExport";
import { validatePNGBuffer } from "@/utils/image/avatarHelper";
import { extractMetadataFromPNG, extractSillyTavernMetadataFromPNG } from "@/utils/image/pngMetadata";
import { presetRepository } from "@/utils/db/repositories/PresetRepository";

type PersonaCardSource = "tomori-png" | "tomori-json" | "sillytavern-png" | "sillytavern-json";

export type PersonaCardResolution =
  | {
      ok: true;
      avatarImageBuffer: Buffer | null;
      presetData: PresetExportData;
      source: PersonaCardSource;
    }
  | {
      ok: false;
      reason: "invalid_png" | "missing_metadata" | "invalid_json" | "invalid_card" | "conversion_failed";
      validationError?: string;
      debugText?: string;
      source?: "png" | "json";
    };

function parseJsonBuffer(buffer: Buffer): unknown {
  const rawText = buffer
    .toString("utf8")
    .replace(/^\uFEFF/, "")
    .trim();
  return JSON.parse(rawText);
}

function buildSillyTavernDebugText(options: {
  conversionError?: string;
  decodedFromBase64?: boolean;
  decodedValueLength?: number;
  metadataKey?: string;
  parsedJson: unknown;
  rawValueLength?: number;
  sourceLabel: string;
}): string {
  const parsedPretty = JSON.stringify(options.parsedJson, null, 2) ?? String(options.parsedJson);
  const parsedRootKeys =
    options.parsedJson && typeof options.parsedJson === "object" && !Array.isArray(options.parsedJson)
      ? Object.keys(options.parsedJson as Record<string, unknown>)
      : [];

  return [
    "TomoriBot Persona Import - SillyTavern Debug Decode",
    `Source: ${options.sourceLabel}`,
    ...(options.metadataKey ? [`Detected metadata key: ${options.metadataKey}`] : []),
    ...(typeof options.decodedFromBase64 === "boolean"
      ? [`Decoded from base64: ${options.decodedFromBase64 ? "yes" : "no"}`]
      : []),
    ...(options.conversionError
      ? [`Conversion error: ${options.conversionError}`]
      : ["Conversion error: (none - decode only mode)"]),
    ...(typeof options.rawValueLength === "number" ? [`Raw metadata length: ${options.rawValueLength}`] : []),
    ...(typeof options.decodedValueLength === "number" ? [`Decoded text length: ${options.decodedValueLength}`] : []),
    `Parsed root keys: ${parsedRootKeys.length > 0 ? parsedRootKeys.join(", ") : "(none/object not detected)"}`,
    "",
    "=== Parsed JSON ===",
    parsedPretty,
  ].join("\n");
}

/**
 * Resolves a native TomoriBot or supported SillyTavern persona card.
 * Downloading, quotas, and user-facing error rendering remain with the caller.
 */
export function resolvePersonaCardFile(fileName: string, buffer: Buffer, maxFileSize: number): PersonaCardResolution {
  const normalizedName = fileName.toLowerCase();

  if (normalizedName.endsWith(".png")) {
    const pngValidation = validatePNGBuffer(buffer, maxFileSize);
    if (!pngValidation.isValid) {
      return { ok: false, reason: "invalid_png" };
    }

    const nativeMetadata = extractMetadataFromPNG(buffer);
    if (nativeMetadata) {
      const validation = presetRepository.validatePresetFile(nativeMetadata);
      return validation.valid && validation.data
        ? { ok: true, avatarImageBuffer: buffer, presetData: validation.data, source: "tomori-png" }
        : { ok: false, reason: "invalid_card", validationError: validation.error };
    }

    const sillyTavernData = extractSillyTavernMetadataFromPNG(buffer);
    if (!sillyTavernData) {
      return { ok: false, reason: "missing_metadata" };
    }

    const conversion = presetRepository.convertSillyTavernMetadataToPresetData(sillyTavernData);
    if (!conversion.success) {
      return {
        ok: false,
        reason: "conversion_failed",
        source: "png",
        debugText: buildSillyTavernDebugText({
          conversionError: conversion.error,
          decodedFromBase64: sillyTavernData.decodedFromBase64,
          decodedValueLength: sillyTavernData.decodedValue.length,
          metadataKey: sillyTavernData.metadataKey,
          parsedJson: sillyTavernData.parsedJson,
          rawValueLength: sillyTavernData.rawValue.length,
          sourceLabel: "PNG metadata",
        }),
      };
    }

    return {
      ok: true,
      avatarImageBuffer: buffer,
      presetData: conversion.data,
      source: "sillytavern-png",
    };
  }

  let parsedJson: unknown;
  try {
    parsedJson = parseJsonBuffer(buffer);
  } catch {
    return { ok: false, reason: "invalid_json" };
  }

  const validation = presetRepository.validatePresetFile(parsedJson);
  if (validation.valid && validation.data) {
    return { ok: true, avatarImageBuffer: null, presetData: validation.data, source: "tomori-json" };
  }

  if (!presetRepository.looksLikeSillyTavernCardJson(parsedJson)) {
    return { ok: false, reason: "invalid_card", validationError: validation.error };
  }

  const conversion = presetRepository.convertSillyTavernJsonToPresetData(parsedJson);
  if (!conversion.success) {
    return {
      ok: false,
      reason: "conversion_failed",
      source: "json",
      debugText: buildSillyTavernDebugText({
        conversionError: conversion.error,
        parsedJson,
        sourceLabel: "JSON attachment",
      }),
    };
  }

  return {
    ok: true,
    avatarImageBuffer: null,
    presetData: conversion.data,
    source: "sillytavern-json",
  };
}
