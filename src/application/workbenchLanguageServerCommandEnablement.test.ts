import { describe, expect, it } from "vitest";
import { emptyLanguageServerCapabilities } from "../domain/languageServerRuntime";
import {
  javaScriptTypeScriptCommandSupports,
  javaScriptTypeScriptFeatureAvailability,
} from "./workbenchLanguageServerCommandEnablement";

const jsTsDocument = {
  isJavaScriptTypeScriptLanguageServerDocument: true,
  isLanguageServerDocument: true,
  language: "typescript",
};

const nonJsTsDocument = {
  isJavaScriptTypeScriptLanguageServerDocument: false,
  isLanguageServerDocument: false,
  language: "text",
};

describe("javaScriptTypeScriptFeatureAvailability", () => {
  it("keeps non-JS/TS documents outside the JS/TS runtime policy", () => {
    const availability = createAvailability({
      activeDocument: nonJsTsDocument,
      javaScriptTypeScriptLanguageServerRuntimeStatus: null,
    });

    expect(availability).toEqual({ kind: "notApplicable" });
    expect(javaScriptTypeScriptCommandSupports(availability, "rename")).toBe(true);
  });

  it("fails closed for a JS/TS document without its exact running workspace runtime", () => {
    expect(
      createAvailability({
        activeDocument: jsTsDocument,
        javaScriptTypeScriptLanguageServerRuntimeStatus: null,
      }),
    ).toEqual({ kind: "unavailable" });
    expect(
      createAvailability({
        activeDocument: jsTsDocument,
        javaScriptTypeScriptLanguageServerRuntimeStatus: {
          capabilities: emptyLanguageServerCapabilities(),
          kind: "running",
          rootPath: "/other",
          sessionId: 7,
        },
      }),
    ).toEqual({ kind: "unavailable" });
  });

  it("presents only capabilities advertised by the exact running JS/TS runtime", () => {
    const availability = createAvailability({
      activeDocument: jsTsDocument,
      javaScriptTypeScriptLanguageServerRuntimeStatus: {
        capabilities: {
          ...emptyLanguageServerCapabilities(),
          definition: true,
          formatting: true,
        },
        kind: "running",
        rootPath: "/workspace",
        sessionId: 8,
      },
    });

    expect(availability.kind).toBe("available");
    expect(javaScriptTypeScriptCommandSupports(availability, "definition")).toBe(true);
    expect(javaScriptTypeScriptCommandSupports(availability, "formatting")).toBe(true);
    expect(javaScriptTypeScriptCommandSupports(availability, "rename")).toBe(false);
  });
});

function createAvailability(
  overrides: Partial<Parameters<typeof javaScriptTypeScriptFeatureAvailability>[0]> = {},
) {
  return javaScriptTypeScriptFeatureAvailability({
    activeDocument: jsTsDocument,
    javaScriptTypeScriptLanguageServerRuntimeStatus: null,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot: null,
    languageServerRuntimeStatus: null,
    languageServerRuntimeStatusRoot: null,
    workspaceRoot: "/workspace",
    ...overrides,
  });
}
