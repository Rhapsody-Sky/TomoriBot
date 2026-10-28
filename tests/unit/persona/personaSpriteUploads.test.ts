import { describe, expect, it } from "bun:test";
import {
  downloadPersonaSpriteImageAttachment,
  validatePersonaSpriteImageAttachment,
} from "@/utils/persona/spriteImages";

describe("browser sprite image attachments", () => {
  it("reads validated files without a network request", async () => {
    const file = new File(["image bytes"], "happy.png", { type: "image/png" });
    expect(validatePersonaSpriteImageAttachment(file)).toEqual({ ok: true });
    expect(await downloadPersonaSpriteImageAttachment(file)).toEqual({ ok: true, buffer: Buffer.from("image bytes") });
  });

  it("rejects unsupported extensions and content types", async () => {
    for (const file of [
      new File(["x"], "happy.svg", { type: "image/png" }),
      new File(["x"], "happy.png", { type: "text/html" }),
    ]) {
      expect(validatePersonaSpriteImageAttachment(file)).toEqual({ ok: false, reason: "invalid_format" });
      expect(await downloadPersonaSpriteImageAttachment(file)).toEqual({ ok: false, reason: "download_failed" });
    }
  });
});
