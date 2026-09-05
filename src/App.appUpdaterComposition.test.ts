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
    expect(host).toMatch(
      /<NoticeToastHost\s+notices=\{notices\}\s+renderNotice=\{renderNotice\}\s*\/>/u,
    );
    expect(host.search(/<NoticeToastHost\b/u)).toBeLessThan(host.search(/<LazySurfaceHost\b/u));
    expect(host).toContain("presentAppUpdateToast(updater.state)");
    expect(host).toContain("appUpdater={updater}");
  });
});
