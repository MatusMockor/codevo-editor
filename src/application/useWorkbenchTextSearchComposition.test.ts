import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("workbench dirty text-search composition", () => {
  it("constructs the browser worker at the outer composition root", () => {
    const source = readFileSync(new URL("../workbenchComposition.ts", import.meta.url), "utf8");

    expect(source).toContain(
      'import { BrowserDirtyTextSearchGateway } from "./infrastructure/browserDirtyTextSearchGateway";',
    );
    expect(source).toContain("dirtyTextSearch: new BrowserDirtyTextSearchGateway()");
  });

  it("injects the port and exact editor-session owner without importing infrastructure", () => {
    const source = readFileSync(new URL("./useWorkbenchController.ts", import.meta.url), "utf8");

    expect(source).not.toContain("../infrastructure/browserDirtyTextSearchGateway");
    expect(source).toContain("workspaceOwnerKey: editorSessionOwnerKey");
    expect(source).toContain("dirtyTextSearch: workspaceGateways.dirtyTextSearch");
  });
});
