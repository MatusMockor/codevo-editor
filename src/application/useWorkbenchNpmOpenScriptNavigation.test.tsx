// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  NpmOpenScriptGatewayOwnerPort,
  NpmOpenScriptNavigationGatewayBinder,
} from "./useNpmOpenScriptNavigation";
import { useWorkbenchNpmOpenScriptNavigation } from "./useWorkbenchNpmOpenScriptNavigation";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useWorkbenchNpmOpenScriptNavigation", () => {
  it("opens without a trust gate and keeps authority stable across unrelated rerenders", async () => {
    const harness = renderComposition();
    const firstOwner = harness.owner();

    await expect(harness.open()).resolves.toBe(true);
    harness.rerender({ discoveryVersion: 1 });

    expect(harness.owner()?.activationEpoch).toBe(firstOwner?.activationEpoch);
    expect(harness.owner()?.nodePackageScriptDiscoveryVersion).toBe(1);
    harness.unmount();
  });

  it("advances authority when a same-value identity object replaces the active owner", () => {
    const harness = renderComposition();
    const firstOwner = harness.owner();

    harness.rerender({ identity: { ...identity() } });

    expect(harness.owner()?.activationEpoch).toBeGreaterThan(firstOwner?.activationEpoch ?? -1);
    expect(harness.owner()?.workspaceId).toBe(firstOwner?.workspaceId);
    harness.unmount();
  });
});

function renderComposition() {
  const container = document.createElement("div");
  const root = createRoot(container);
  const ownerRef: { current: NpmOpenScriptGatewayOwnerPort | null } = { current: null };
  const gateway: NpmOpenScriptNavigationGatewayBinder = {
    bindNpmOpenScriptNavigation: (ownerPort) => {
      ownerRef.current = ownerPort;
      return {
        readManifestBounded: async () => ({
          content: '{"scripts":{"build":"vite"}}',
          isCurrent: () => ownerRef.current?.() !== null,
          revision: "owner-lease",
          status: "ok",
        }),
      };
    },
  };
  const opener = vi.fn(async () => true);
  let options = {
    discoveryVersion: 0,
    documents: [],
    gateway,
    identity: identity(),
    openNavigationTarget: opener,
    rootPath: "/workspace",
  };
  let open: ReturnType<typeof useWorkbenchNpmOpenScriptNavigation> | null = null;
  function Harness() {
    open = useWorkbenchNpmOpenScriptNavigation(options);
    return null;
  }
  const render = () => act(() => root.render(<Harness />));
  render();
  return {
    open: () => {
      if (!open) throw new Error("missing composition");
      return open({ manifestRelativePath: "package.json", scriptName: "build" });
    },
    owner: () => ownerRef.current?.() ?? null,
    rerender: (next: Partial<typeof options>) => {
      options = { ...options, ...next };
      render();
    },
    unmount: () => act(() => root.unmount()),
  };
}

function identity() {
  return {
    canonicalRoot: "/workspace",
    policy: { caseSensitive: true as const, unicodeNormalization: "none" as const },
    selectedPath: "/workspace",
    workspaceId: "workspace-id",
  };
}
