// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceDescriptor } from "../domain/workspace";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import { createPhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import { usePhpLaravelRelationResolver } from "./usePhpLaravelRelationResolver";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/workspace";
const GENERIC_RUNTIME = createPhpFrameworkRuntimeContext(
  createPhpFrameworkIntelligence({
    matchedProviderIds: [],
    profile: "generic",
    providers: [],
  }),
);

type HookOptions = Parameters<typeof usePhpLaravelRelationResolver>[0];
type HookApi = ReturnType<typeof usePhpLaravelRelationResolver>;

function phpDescriptor(): WorkspaceDescriptor {
  return {
    javaScriptTypeScript: null,
    php: {
      classmapRoots: [],
      hasComposer: true,
      packageName: null,
      packages: [],
      phpPlatformVersion: null,
      phpVersionConstraint: null,
      psr4Roots: [],
    },
    rootPath: ROOT,
  };
}

function makeOptions(overrides: Partial<HookOptions> = {}): HookOptions {
  return {
    currentWorkspaceRootRef: { current: ROOT },
    isLaravelFrameworkActive: true,
    readPhpClassMembersFromPath: vi.fn(async () => ({
      content: "",
      members: [],
    })),
    resolvePhpClassReference: vi.fn((_source, className) => className),
    resolvePhpClassSourcePaths: vi.fn(async () => []),
    resolvePhpDeclaredType: vi.fn(() => null),
    resolvePhpGenericTemplateTypesForInheritedClass: vi.fn(async () => new Map()),
    resolvePhpGenericTemplateTypesForMixinClass: vi.fn(async () => new Map()),
    resolvePhpLaravelProjectMorphMapModelType: vi.fn(async () => null),
    workspaceDescriptor: phpDescriptor(),
    workspaceRoot: ROOT,
    ...overrides,
  };
}

function renderHook(options: HookOptions) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { api: HookApi | null } = { api: null };

  function Harness({ hookOptions }: { hookOptions: HookOptions }) {
    captured.api = usePhpLaravelRelationResolver(hookOptions);
    return null;
  }

  act(() => {
    root.render(<Harness hookOptions={options} />);
  });

  return {
    api: () => {
      if (!captured.api) {
        throw new Error("hook not mounted");
      }

      return captured.api;
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

describe("usePhpLaravelRelationResolver", () => {
  it("uses runtime Laravel state over the legacy boolean", async () => {
    const resolvePhpClassSourcePaths = vi.fn(async () => ["/unused.php"]);
    const options = makeOptions({
      frameworkRuntime: GENERIC_RUNTIME,
      isLaravelFrameworkActive: true,
      resolvePhpClassSourcePaths,
    });
    const harness = renderHook(options);

    await expect(
      harness
        .api()
        .resolvePhpLaravelRelationPathOwnerType("App\\Models\\Comment", [
          "author",
        ]),
    ).resolves.toBeNull();

    expect(resolvePhpClassSourcePaths).not.toHaveBeenCalled();

    harness.unmount();
  });
});
