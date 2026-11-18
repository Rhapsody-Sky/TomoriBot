import { describe, expect, it } from "bun:test";
import type { SQL } from "bun";
import { seedPersonasFromCatalog } from "@/db/seed/catalog/personaSeed";
import { personaSections } from "@/db/seed/catalog/personas";
import { str } from "@/db/seed/catalog/sql";

describe("persona catalog visibility", () => {
  it("upserts both Zaya presets with authored visibility and keeps the default for other official presets", async () => {
    const statements: string[] = [];
    const client = {
      unsafe: async (statement: string) => {
        statements.push(statement);
      },
    } as unknown as SQL;
    await seedPersonasFromCatalog(client);

    const upsert = statements.at(-1);
    expect(upsert).toContain("preset_attribute_public_flags = EXCLUDED.preset_attribute_public_flags");
    const zayaVariants = personaSections.flatMap(({ rows }) => rows).filter(({ lineageId }) => lineageId === 1337);
    expect(zayaVariants.map(({ language }) => language).sort()).toEqual(["en-US", "ja"]);
    const defaultPersona = personaSections.find(({ rows }) => rows.some(({ lineageId }) => lineageId === 4))?.rows[0];
    if (!defaultPersona) throw new Error("Tomori preset is missing");
    for (const preset of [...zayaVariants, defaultPersona]) {
      const row = upsert?.split("\n").find((line) => line.startsWith(`  (${str(preset.name)},`));
      const flags = preset.attributes.map(
        (_, index) => index === 0 || (preset.lineageId === 1337 && index === preset.attributes.length - 1),
      );
      expect(row).toContain(`ARRAY[${flags.join(", ")}]::BOOLEAN[]`);
    }
  });
});
