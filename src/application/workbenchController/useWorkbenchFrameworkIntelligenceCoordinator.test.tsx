// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { createWorkspaceRuntimeOwner } from "../../domain/workspaceRuntimeOwner";
import {
  usePhpFrameworkDefinitionNavigationActivation,
  type PhpFrameworkDefinitionNavigationActivationDependencies,
} from "./useWorkbenchFrameworkIntelligenceCoordinator";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("usePhpFrameworkDefinitionNavigationActivation", () => {
  it("rejects stale A1 navigation and admits fresh A2 after same-owner replacement", () => {
    const rootPath = "/workspace";
    const owner = createWorkspaceRuntimeOwner("workspace-a", rootPath);
    const currentWorkspaceRootRef = { current: rootPath };
    const generationRef = { current: 1 };
    const captured: {
      current: ReturnType<typeof usePhpFrameworkDefinitionNavigationActivation> | null;
    } = { current: null };
    const root = createRoot(document.createElement("div"));

    function Harness({ generation }: { readonly generation: number }) {
      const dependencies: PhpFrameworkDefinitionNavigationActivationDependencies = {
        currentWorkspaceRootRef,
        generation,
        generationRef,
        ownerKey: owner.ownerKey,
        resolveCurrentWorkspaceRuntimeOwner: () => owner,
        rootPath,
      };
      captured.current = usePhpFrameworkDefinitionNavigationActivation(dependencies);
      return null;
    }

    const requireActivation = () => {
      const current = captured.current;
      if (!current) throw new Error("Framework activation did not render");
      return current;
    };

    act(() => root.render(<Harness generation={1} />));
    const staleActivation = requireActivation();

    generationRef.current = 2;
    act(() => root.render(<Harness generation={2} />));
    const freshActivation = requireActivation();

    expect(staleActivation.isCurrent()).toBe(false);
    expect(freshActivation).not.toBe(staleActivation);
    expect(freshActivation.isCurrent()).toBe(true);

    act(() => root.unmount());
  });
});
