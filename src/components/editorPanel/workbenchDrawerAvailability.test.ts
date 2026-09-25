import { describe, expect, it } from "vitest";
import { editorDrawerAvailabilityFromPanel } from "./workbenchDrawerAvailability";

describe("editorDrawerAvailabilityFromPanel", () => {
  it("mirrors the old bottom panel's conditional tabs", () => {
    expect(
      editorDrawerAvailabilityFromPanel({
        hasArtisan: true,
        hasExpressRoutes: false,
        hasJsWorkspace: false,
        hasNette: true,
        hasPhpWorkspace: true,
        hasSymfony: false,
      }),
    ).toEqual({
      artisan: true,
      expressRoutes: false,
      javaScriptWorkspace: false,
      nette: true,
      symfony: false,
      phpWorkspace: true,
    });
  });

  it("offers Express routes only with a route signal or while the view is already open, like BottomPanel did", () => {
    expect(editorDrawerAvailabilityFromPanel({ hasJsWorkspace: true }).expressRoutes).toBe(false);
    expect(
      editorDrawerAvailabilityFromPanel({ hasJsWorkspace: true }, "expressRoutes").expressRoutes,
    ).toBe(true);
    expect(editorDrawerAvailabilityFromPanel({}, "expressRoutes").expressRoutes).toBe(false);
    expect(editorDrawerAvailabilityFromPanel({}).javaScriptWorkspace).toBe(false);
  });
});
