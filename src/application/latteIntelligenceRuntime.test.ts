import { describe, expect, it } from "vitest";
import {
  activeLatteWorkspaceContext,
  currentTemplatePath,
  evictOtherRootCacheEntries,
  isLattePresenterLinkIntelligenceActive,
  isLatteSemanticActive,
  offsetAtEditorPosition,
  type LatteRuntimeCapabilities,
  type LatteRuntimeDependencies,
} from "./latteIntelligenceRuntime";

const templateCapabilities: LatteRuntimeCapabilities = {
  supportsLattePresenterLinkIntelligence: () => false,
  supportsLatteTemplateIntelligence: () => true,
};

const linkCapabilities: LatteRuntimeCapabilities = {
  supportsLattePresenterLinkIntelligence: () => true,
  supportsLatteTemplateIntelligence: () => true,
};

const inertCapabilities: LatteRuntimeCapabilities = {
  supportsLattePresenterLinkIntelligence: () => false,
  supportsLatteTemplateIntelligence: () => false,
};

function deps(
  overrides: Partial<LatteRuntimeDependencies> = {},
): LatteRuntimeDependencies {
  return {
    currentWorkspaceRootRef: { current: "/ws" },
    frameworkIntelligence: { providers: [{ id: "nette" }] },
    getActiveDocument: () => ({ path: "/ws/app/UI/Home/default.latte" }),
    isSemanticIntelligenceActive: true,
    toRelativePath: (root, path) =>
      path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path,
    workspaceRoot: "/ws",
    ...overrides,
  };
}

describe("activeLatteWorkspaceContext", () => {
  it("returns requested root and live root guard when semantic Latte is active", () => {
    const context = activeLatteWorkspaceContext(deps(), templateCapabilities);

    expect(context?.requestedRoot).toBe("/ws");
    expect(context?.isRequestedRootActive()).toBe(true);
  });

  it("drops inactive semantic mode, unsupported providers and missing roots", () => {
    expect(
      activeLatteWorkspaceContext(
        deps({ isSemanticIntelligenceActive: false }),
        templateCapabilities,
      ),
    ).toBeNull();
    expect(activeLatteWorkspaceContext(deps(), inertCapabilities)).toBeNull();
    expect(
      activeLatteWorkspaceContext(deps({ workspaceRoot: null }), templateCapabilities),
    ).toBeNull();
  });

  it("keeps the guard tied to the captured requested root", () => {
    const rootRef = { current: "/ws" };
    const context = activeLatteWorkspaceContext(
      deps({ currentWorkspaceRootRef: rootRef }),
      templateCapabilities,
    );

    rootRef.current = "/other";

    expect(context?.isRequestedRootActive()).toBe(false);
  });
});

describe("Latte runtime helpers", () => {
  it("resolves the current template relative to the requested workspace root", () => {
    expect(currentTemplatePath(deps(), "/ws")).toBe(
      "app/UI/Home/default.latte",
    );
    expect(currentTemplatePath(deps({ getActiveDocument: () => null }), "/ws"))
      .toBe("");
  });

  it("evicts every cache root except the requested root", () => {
    const cache = {
      "/other": { value: 1 },
      "/ws": { value: 2 },
    };

    evictOtherRootCacheEntries(cache, "/ws");

    expect(cache).toEqual({ "/ws": { value: 2 } });
  });

  it("evicts all cache roots when no workspace is active", () => {
    const cache = {
      "/a": { value: 1 },
      "/b": { value: 2 },
    };

    evictOtherRootCacheEntries(cache, null);

    expect(cache).toEqual({});
  });

  it("checks semantic and presenter-link gates independently", () => {
    expect(isLatteSemanticActive(deps(), templateCapabilities)).toBe(true);
    expect(isLattePresenterLinkIntelligenceActive(deps(), templateCapabilities))
      .toBe(false);
    expect(isLattePresenterLinkIntelligenceActive(deps(), linkCapabilities))
      .toBe(true);
  });

  it("converts Monaco line/column positions into source offsets", () => {
    const source = "alpha\nbeta\ngamma";

    expect(offsetAtEditorPosition(source, { column: 1, lineNumber: 1 })).toBe(0);
    expect(offsetAtEditorPosition(source, { column: 3, lineNumber: 2 })).toBe(8);
    expect(offsetAtEditorPosition(source, { column: 99, lineNumber: 2 })).toBe(10);
    expect(offsetAtEditorPosition(source, { column: 1, lineNumber: 99 })).toBe(
      source.length,
    );
  });
});
