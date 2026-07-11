import { describe, expect, it, vi } from "vitest";
import { phpNetteFrameworkProvider } from "../domain/phpFrameworkProviders";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import {
  createNeonRequestContext,
  offsetAtEditorPosition,
  type NeonRuntimeDependencies,
} from "./neonIntelligenceRuntime";
import type { NeonConfigCache } from "./neonProjectConfigDiscovery";

const ROOT = "/ws";
const NETTE_FRAMEWORK = createPhpFrameworkIntelligence({
  matchedProviderIds: ["nette"],
  profile: "nette",
  providers: [phpNetteFrameworkProvider],
});
const GENERIC_FRAMEWORK = createPhpFrameworkIntelligence({
  matchedProviderIds: [],
  profile: "generic",
  providers: [],
});
const STALE_NETTE_PROFILE_WITHOUT_PROVIDER = createPhpFrameworkIntelligence({
  matchedProviderIds: [],
  profile: "nette",
  providers: [],
});

function makeDeps(
  overrides: Partial<NeonRuntimeDependencies> = {},
): NeonRuntimeDependencies {
  return {
    currentWorkspaceRootRef: { current: ROOT },
    frameworkIntelligence: NETTE_FRAMEWORK,
    getActiveDocument: () => ({ path: `${ROOT}/config/config.neon` }),
    isSemanticIntelligenceActive: true,
    joinPath: (rootPath, relativePath) => `${rootPath}/${relativePath}`,
    listDirectory: vi.fn(async () => []),
    readFileContent: vi.fn(async () => ""),
    workspaceRoot: ROOT,
    ...overrides,
  };
}

describe("createNeonRequestContext", () => {
  it("returns null when semantic intelligence is inactive", () => {
    const context = createNeonRequestContext(
      makeDeps({ isSemanticIntelligenceActive: false }),
      {},
      new Map(),
    );

    expect(context).toBeNull();
  });

  it("returns null when no provider supports NEON intelligence", () => {
    expect(
      createNeonRequestContext(
        makeDeps({ frameworkIntelligence: GENERIC_FRAMEWORK }),
        {},
        new Map(),
      ),
    ).toBeNull();
    expect(
      createNeonRequestContext(
        makeDeps({ frameworkIntelligence: STALE_NETTE_PROFILE_WITHOUT_PROVIDER }),
        {},
        new Map(),
      ),
    ).toBeNull();
  });

  it("returns null without a workspace root", () => {
    const context = createNeonRequestContext(
      makeDeps({ workspaceRoot: null }),
      {},
      new Map(),
    );

    expect(context).toBeNull();
  });

  it("evicts other cached roots before returning a live-root-aware context", () => {
    const cache: NeonConfigCache = {
      "/other": {
        config: emptyConfig(),
        expiresAt: Date.now() + 1_000,
      },
      [ROOT]: {
        config: emptyConfig(),
        expiresAt: Date.now() + 1_000,
      },
    };
    const currentWorkspaceRootRef = { current: ROOT };
    const context = createNeonRequestContext(
      makeDeps({ currentWorkspaceRootRef }),
      cache,
      new Map(),
    );

    expect(Object.keys(cache)).toEqual([ROOT]);
    expect(context?.requestedRoot).toBe(ROOT);
    expect(context?.isRequestedRootActive()).toBe(true);

    currentWorkspaceRootRef.current = "/elsewhere";

    expect(context?.isRequestedRootActive()).toBe(false);
  });
});

describe("offsetAtEditorPosition", () => {
  it("converts editor positions to clamped offsets", () => {
    const source = "one\ntwo\nthree";

    expect(offsetAtEditorPosition(source, { column: 2, lineNumber: 2 })).toBe(5);
    expect(offsetAtEditorPosition(source, { column: 99, lineNumber: 2 })).toBe(7);
    expect(offsetAtEditorPosition(source, { column: 1, lineNumber: 99 })).toBe(
      source.length,
    );
    expect(offsetAtEditorPosition(source, { column: -5, lineNumber: -1 })).toBe(0);
  });
});

function emptyConfig() {
  return {
    parameterNames: [],
    parameters: new Map(),
    serviceAliases: new Map(),
    serviceNameTypes: new Map(),
    serviceNames: [],
    services: new Map(),
    serviceTypeLocations: new Map(),
    serviceTypes: new Map(),
  };
}
