import { describe, expect, it } from "vitest";
import { agentPaletteProjects, agentPaletteScripts } from "./agentPaletteSources";

describe("agent palette sources", () => {
  it("turns workspace tabs into projects and marks the active root", () => {
    expect(agentPaletteProjects(["/u/orders-api", "/u/web-dashboard/"], "/u/orders-api")).toEqual([
      { key: "/u/orders-api", label: "orders-api", path: "/u/orders-api", current: true },
      {
        key: "/u/web-dashboard/",
        label: "web-dashboard",
        path: "/u/web-dashboard/",
        current: false,
      },
    ]);
  });

  it("describes node scripts with their package manager and runnable state", () => {
    const scripts = agentPaletteScripts(
      [
        {
          key: "k",
          manifestRelativePath: "package.json",
          packageName: null,
          packageManager: "pnpm",
          packageRootRelativePath: "",
          scriptName: "test",
        },
      ],
      (commandId) => commandId === "script.node.k",
    );
    expect(scripts).toEqual([{ key: "k", name: "test", detail: "pnpm run test", runnable: true }]);
  });
});
