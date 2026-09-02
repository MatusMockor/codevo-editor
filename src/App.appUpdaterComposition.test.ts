import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("application updater composition", () => {
  it("always mounts the updater host instead of gating it behind the lazy settings surface", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    const host = readFileSync(
      new URL("./components/WorkbenchAppUpdaterHost.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("<WorkbenchAppUpdaterHost");
    expect(source).toContain("composition={workbenchComposition.appUpdater}");
    expect(source).not.toContain("appUpdaterComposition=");
    expect(host).toContain("useWorkbenchAppUpdaterComposition(");
    expect(host).toContain("workbench.persistAppUpdaterSkippedVersion");
    expect(host.indexOf("<AppUpdateDialog updater={updater} />")).toBeLessThan(
      host.indexOf("<LazySurfaceHost"),
    );
    expect(host).toContain("appUpdater={updater}");
  });
});
