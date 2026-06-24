import { describe, expect, it, vi } from "vitest";
import type { SystemFontGateway } from "../domain/systemFonts";
import { TauriSystemFontGateway } from "./tauriSystemFontGateway";

describe("TauriSystemFontGateway", () => {
  it("invokes the native monospace font command in Tauri", async () => {
    const invoke = vi.fn(async () => ["Fira Code", "Iosevka"]);
    const gateway = new TauriSystemFontGateway(invoke, () => true);

    await expect(gateway.listMonospaceFontFamilies()).resolves.toEqual([
      "Fira Code",
      "Iosevka",
    ]);
    expect(invoke).toHaveBeenCalledWith("list_monospace_font_families");
  });

  it("uses the browser fallback outside Tauri", async () => {
    const fallback: SystemFontGateway = {
      listMonospaceFontFamilies: vi.fn(async () => ["JetBrains Mono"]),
    };
    const gateway = new TauriSystemFontGateway(vi.fn(), () => false, fallback);

    await expect(gateway.listMonospaceFontFamilies()).resolves.toEqual([
      "JetBrains Mono",
    ]);
    expect(fallback.listMonospaceFontFamilies).toHaveBeenCalled();
  });
});
