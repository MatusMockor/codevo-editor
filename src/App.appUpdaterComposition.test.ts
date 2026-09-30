import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("application updater composition", () => {
  it("owns one updater in App and shares it with the toast host and the agent rail", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    const host = readFileSync(
      new URL("./components/WorkbenchAppUpdaterHost.tsx", import.meta.url),
      "utf8",
    );
    const overlays = readFileSync(
      new URL("./components/WorkbenchOverlayDialogsHost.tsx", import.meta.url),
      "utf8",
    );
    const lazySurfaces = readFileSync(
      new URL("./components/appLazySurfaces.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("<WorkbenchOverlayDialogsHost");
    expect(overlays).toContain("<WorkbenchAppUpdaterHost");
    expect(source).toContain(
      "useWorkbenchAppUpdaterComposition(workbenchComposition.appUpdater, workbench)",
    );
    expect(source.match(/useWorkbenchAppUpdaterComposition\(/gu)).toHaveLength(1);
    expect(source.match(/appUpdater=\{appUpdater\}/gu)).toHaveLength(2);
    expect(source).not.toContain("appUpdaterComposition=");
    expect(host).not.toContain("useWorkbenchAppUpdaterComposition(");
    expect(host).not.toContain("useAppUpdater(");
    expect(lazySurfaces).toContain("<AppUpdaterContext.Provider value={appUpdater}>");
    expect(host).toMatch(
      /<NoticeToastHost\s+notices=\{notices\}\s+renderNotice=\{renderNotice\}\s*\/>/u,
    );
    expect(host.search(/<NoticeToastHost\b/u)).toBeLessThan(host.search(/<LazySurfaceHost\b/u));
    expect(host).toContain("presentAppUpdateToast(updater.state)");
    expect(host).toContain("appUpdater={updater}");
    expect(host).not.toContain("appUpdateChannel");
    expect(host).not.toContain("appSettingsHydrated");
    const composition = readFileSync(new URL("./workbenchComposition.ts", import.meta.url), "utf8");
    expect(composition).toContain("createAppUpdateCheck(");
    expect(composition).not.toContain('from "@tauri-apps/plugin-updater"');
  });
});
