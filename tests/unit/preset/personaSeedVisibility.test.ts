import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { SQL } from "bun";
import { seedPersonasFromCatalog } from "@/db/seed/catalog/personaSeed";
import { personaSections } from "@/db/seed/catalog/personas";
import { PRESET_NATURAL_NUDGE_DEFAULTS } from "@/db/seed/catalog/personas/naturalNudges";
import type { CatalogSection, PersonaInput } from "@/db/seed/catalog/types";

describe("catalog attribute visibility", () => {
  let section: CatalogSection<PersonaInput>;
  let preset: PersonaInput;
  let statements: string[];
  let client: SQL;

  beforeEach(() => {
    preset = {
      name: "Visibility fixture",
      desc: "Seed visibility test",
      attributes: ["Appearance", "Other trait"],
      sampleDialoguesIn: [],
      sampleDialoguesOut: [],
      language: "test",
      avatarPath: "unused",
      triggerWords: [],
      lineageId: 1337,
      namingConfig: { prefixes: {}, suffixes: {}, addressTerms: {} },
    };
    section = { comment: "Visibility fixture", rows: [preset] };
    personaSections.push(section);
    statements = [];
    client = {
      unsafe: async (statement: string) => {
        statements.push(statement);
      },
    } as unknown as SQL;
  });

  afterEach(() => {
    personaSections.splice(personaSections.indexOf(section), 1);
  });

  function fixtureRow(): string | undefined {
    return statements
      .find((statement) => statement.startsWith("INSERT INTO persona_presets"))
      ?.split("\n")
      .find((line) => line.startsWith("  ('Visibility fixture',"));
  }

  it("preserves explicit visibility on insertion and repeated upserts", async () => {
    preset.attributePublicFlags = [false, true];
    await seedPersonasFromCatalog(client);
    expect(fixtureRow()).toContain("ARRAY[false, true]::BOOLEAN[]");
    expect(statements.join("\n")).toContain("preset_attribute_public_flags = EXCLUDED.preset_attribute_public_flags");
    // A later normalization statement must not reset the authored flags.
    expect(statements.at(-1)).toStartWith("INSERT INTO persona_presets");
    const firstSeed = [...statements];
    statements.length = 0;
    await seedPersonasFromCatalog(client);
    expect(statements).toEqual(firstSeed);
  });

  it("keeps the official first-attribute-public default when flags are omitted", async () => {
    await seedPersonasFromCatalog(client);
    expect(fixtureRow()).toContain("ARRAY[true, false]::BOOLEAN[]");
  });

  it("keeps other lineages private when flags are omitted", async () => {
    preset.lineageId = 999999;
    PRESET_NATURAL_NUDGE_DEFAULTS[999999] = PRESET_NATURAL_NUDGE_DEFAULTS[1337]!;
    try {
      await seedPersonasFromCatalog(client);
      expect(fixtureRow()).toContain("ARRAY[false, false]::BOOLEAN[]");
    } finally {
      delete PRESET_NATURAL_NUDGE_DEFAULTS[999999];
    }
  });

  it("allows explicit all-private flags on an official lineage", async () => {
    preset.attributePublicFlags = [false, false];
    await seedPersonasFromCatalog(client);
    expect(fixtureRow()).toContain("ARRAY[false, false]::BOOLEAN[]");
  });

  it("rejects misaligned visibility before issuing any database writes", async () => {
    preset.attributePublicFlags = [true];
    await expect(seedPersonasFromCatalog(client)).rejects.toThrow(
      "attributePublicFlags length 1 does not match attributes length 2",
    );
    expect(statements).toEqual([]);
  });
});
