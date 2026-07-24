// @vitest-environment jsdom

import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NodePackageScript } from "../domain/nodePackageScripts";
import { createWorkspaceRoot, type WorkspaceRootDescriptor } from "../domain/workspacePath";
import type { EditorDocument } from "../domain/workspace";
import {
  useNpmOpenScriptNavigation,
  type NpmOpenScriptManifestRead,
  type NpmOpenScriptNavigationGateway,
  type NpmOpenScriptNavigationOwner,
  type UseNpmOpenScriptNavigationOptions,
} from "./useNpmOpenScriptNavigation";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const SOURCE = `{
  "scripts": {
    "build": "vite"
  }
}`;
const SCRIPT: Pick<NodePackageScript, "manifestRelativePath" | "scriptName"> = {
  manifestRelativePath: "package.json",
  scriptName: "build",
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useNpmOpenScriptNavigation", () => {
  it("opens a bounded, versioned manifest under the explicit owner", async () => {
    const harness = renderNavigation();

    await expect(harness.open()(SCRIPT)).resolves.toBe(true);

    expect(harness.gateway.readManifestBounded).toHaveBeenCalledWith({
      activationEpoch: 1,
      manifestRelativePath: "package.json",
      maxBytes: 1_048_576,
      ownerKey: "owner:1",
      rootPath: "/workspace",
      workspaceId: "workspace-id",
    });
    expect(harness.opener).toHaveBeenCalledWith(
      "/workspace/package.json",
      { column: 5, lineNumber: 3 },
      "build",
      {
        activationEpoch: 1,
        ownerKey: "owner:1",
        shouldCommit: expect.any(Function),
        workspaceId: "workspace-id",
      },
    );
    harness.unmount();
  });

  it("treats clean and dirty open manifests as authoritative versioned snapshots", async () => {
    for (const document of [manifest(SOURCE, SOURCE), manifest(SOURCE, "old")]) {
      const harness = renderNavigation({ documents: [document] });
      await expect(harness.open()(SCRIPT)).resolves.toBe(true);
      expect(harness.gateway.readManifestBounded).not.toHaveBeenCalled();
      harness.unmount();
    }
  });

  it("uses authoritative descriptor policies and aliases for open manifests", async () => {
    const policy = {
      caseSensitive: false as const,
      foldCase: (value: string) => value.toLowerCase(),
      unicodeNormalization: "none" as const,
    };
    const selected = root("workspace-id", "/Selected", policy);
    const canonical = root("workspace-id", "/Canonical", policy);
    const owner = makeOwner({ rootPath: "/Selected", workspaceRoots: [selected, canonical] });
    const harness = renderNavigation({
      documents: [manifest(SOURCE, SOURCE, "/canonical/PACKAGE.JSON")],
      owner,
    });

    await expect(harness.open()(SCRIPT)).resolves.toBe(true);
    expect(harness.gateway.readManifestBounded).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("invalidates stale callbacks for same-root authority and port replacement", async () => {
    const harness = renderNavigation();
    const stale = harness.open();
    harness.rerender({ owner: makeOwner({ ownerKey: "owner:2" }) });
    await expect(stale(SCRIPT)).resolves.toBe(false);

    const staleEpoch = harness.open();
    harness.rerender({ owner: makeOwner({ activationEpoch: 2, ownerKey: "owner:2" }) });
    await expect(staleEpoch(SCRIPT)).resolves.toBe(false);

    const stalePorts = harness.open();
    harness.rerender({ gateway: gateway(), openNavigationTarget: vi.fn(async () => true) });
    await expect(stalePorts(SCRIPT)).resolves.toBe(false);
    expect(harness.opener).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("never resurrects A after A to B to A and a stale callback cannot cancel B", async () => {
    const ownerA = makeOwner();
    const ownerB = makeOwner({ activationEpoch: 2, ownerKey: "owner:2" });
    const readB = deferred<NpmOpenScriptManifestRead>();
    const gatewayA = gateway();
    const gatewayB = gateway(() => readB.promise);
    const opener = vi.fn(async () => true);
    const harness = renderNavigation({
      gateway: gatewayA,
      openNavigationTarget: opener,
      owner: ownerA,
    });
    const staleA = harness.open();

    harness.rerender({ gateway: gatewayB, owner: ownerB });
    const pendingB = harness.open()(SCRIPT);
    await expect(staleA(SCRIPT)).resolves.toBe(false);
    readB.resolve(lease(SOURCE));
    await expect(pendingB).resolves.toBe(true);

    harness.rerender({ gateway: gatewayA, owner: ownerA });
    await expect(staleA(SCRIPT)).resolves.toBe(false);
    expect(opener).toHaveBeenCalledOnce();
    harness.unmount();
  });

  it("remains live through StrictMode setup-cleanup-setup", async () => {
    const harness = renderNavigation({}, true);
    await expect(harness.open()(SCRIPT)).resolves.toBe(true);
    expect(harness.opener).toHaveBeenCalledOnce();
    harness.unmount();
  });

  it("uses latest-wins request tokens for parallel invocations", async () => {
    const first = deferred<NpmOpenScriptManifestRead>();
    const second = deferred<NpmOpenScriptManifestRead>();
    const gatewayPort = gateway();
    gatewayPort.readManifestBounded
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const harness = renderNavigation({ gateway: gatewayPort });
    const firstRequest = harness.open()(SCRIPT);
    const secondRequest = harness.open()(SCRIPT);

    second.resolve(lease(SOURCE));
    await expect(secondRequest).resolves.toBe(true);
    first.resolve(lease(SOURCE));
    await expect(firstRequest).resolves.toBe(false);
    expect(harness.opener).toHaveBeenCalledOnce();
    harness.unmount();
  });

  it("revalidates the disk lease before open, inside commit, and after open", async () => {
    let current = true;
    const opening = deferred<boolean>();
    let shouldCommit: (() => boolean) | undefined;
    const opener = vi.fn(
      async (...args: Parameters<UseNpmOpenScriptNavigationOptions["openNavigationTarget"]>) => {
        shouldCommit = args[3].shouldCommit;
        return opening.promise;
      },
    );
    const harness = renderNavigation({
      gateway: gateway(async () => lease(SOURCE, () => current)),
      openNavigationTarget: opener,
    });
    const pending = harness.open()(SCRIPT);
    await vi.waitFor(() => expect(opener).toHaveBeenCalledOnce());
    expect(shouldCommit?.()).toBe(true);

    current = false;
    expect(shouldCommit?.()).toBe(false);
    opening.resolve(true);
    await expect(pending).resolves.toBe(false);
    harness.unmount();
  });

  it("invalidates an open-document snapshot when its content or saved version changes", async () => {
    const opening = deferred<boolean>();
    let shouldCommit: (() => boolean) | undefined;
    const opener = vi.fn(
      async (...args: Parameters<UseNpmOpenScriptNavigationOptions["openNavigationTarget"]>) => {
        shouldCommit = args[3].shouldCommit;
        return opening.promise;
      },
    );
    const harness = renderNavigation({
      documents: [manifest(SOURCE, SOURCE)],
      openNavigationTarget: opener,
    });
    const pending = harness.open()(SCRIPT);
    await vi.waitFor(() => expect(opener).toHaveBeenCalledOnce());

    harness.rerender({ documents: [manifest(SOURCE, "new saved version")] });
    expect(shouldCommit?.()).toBe(false);
    opening.resolve(true);
    await expect(pending).resolves.toBe(false);
    harness.unmount();
  });

  it.each([
    ["traversal", { ...SCRIPT, manifestRelativePath: "../package.json" }],
    ["absolute", { ...SCRIPT, manifestRelativePath: "/package.json" }],
    ["malformed", { ...SCRIPT, scriptName: "" }],
  ])("fails closed for %s selection", async (_label, script) => {
    const harness = renderNavigation();
    await expect(harness.open()(script)).resolves.toBe(false);
    expect(harness.opener).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("fails closed for invalid leases, read failures, missing scripts, and ambiguous documents", async () => {
    const cases: HarnessOptions[] = [
      { gateway: gateway(async () => ({ status: "missing" })) },
      { gateway: gateway(async () => ({ status: "tooLarge" })) },
      { gateway: gateway(async () => ({ ...lease(SOURCE), revision: "" })) },
      { gateway: gateway(async () => lease(SOURCE, () => false)) },
      { gateway: gateway(async () => Promise.reject(new Error("secret"))) },
      { documents: [manifest('{"scripts":{}}', "old")] },
      { documents: [manifest(SOURCE, "a"), manifest(SOURCE, "b")] },
    ];
    for (const options of cases) {
      const harness = renderNavigation(options);
      await expect(harness.open()(SCRIPT)).resolves.toBe(false);
      expect(harness.opener).not.toHaveBeenCalled();
      harness.unmount();
    }
  });
});

type HarnessOptions = Partial<UseNpmOpenScriptNavigationOptions>;

function renderNavigation(initial: HarnessOptions = {}, strict = false) {
  const container = document.createElement("div");
  const reactRoot = createRoot(container);
  let options: UseNpmOpenScriptNavigationOptions = {
    documents: [],
    gateway: gateway(),
    openNavigationTarget: vi.fn(async () => true),
    owner: makeOwner(),
    ...initial,
  };
  let captured: ReturnType<typeof useNpmOpenScriptNavigation> | null = null;
  function Harness({ value }: { value: UseNpmOpenScriptNavigationOptions }) {
    captured = useNpmOpenScriptNavigation(value);
    return null;
  }
  const render = () => {
    const child = <Harness value={options} />;
    act(() => reactRoot.render(strict ? <StrictMode>{child}</StrictMode> : child));
  };
  render();
  return {
    gateway: options.gateway as ReturnType<typeof gateway>,
    open: () => {
      if (!captured) throw new Error("hook not mounted");
      return captured;
    },
    opener: options.openNavigationTarget as ReturnType<typeof vi.fn>,
    rerender: (next: HarnessOptions) => {
      options = { ...options, ...next };
      render();
    },
    unmount: () => act(() => reactRoot.unmount()),
  };
}

function makeOwner(
  overrides: Partial<NpmOpenScriptNavigationOwner> = {},
): NpmOpenScriptNavigationOwner {
  return {
    activationEpoch: 1,
    ownerKey: "owner:1",
    rootPath: "/workspace",
    workspaceId: "workspace-id",
    workspaceRoots: [root("workspace-id", "/workspace")],
    ...overrides,
  };
}

function root(
  workspaceId: string,
  path: string,
  policy?: Parameters<typeof createWorkspaceRoot>[2],
): WorkspaceRootDescriptor {
  const result = createWorkspaceRoot(workspaceId, path, policy);
  if (!result.ok) throw new Error("invalid test root");
  return result.value;
}

function gateway(
  read: NpmOpenScriptNavigationGateway["readManifestBounded"] = async () => lease(SOURCE),
) {
  return { readManifestBounded: vi.fn(read) };
}

function lease(content: string, isCurrent: () => boolean = () => true): NpmOpenScriptManifestRead {
  return { content, isCurrent, revision: "revision:1", status: "ok" };
}

function manifest(
  content: string,
  savedContent: string,
  path = "/workspace/package.json",
): EditorDocument {
  return { content, language: "json", name: "package.json", path, savedContent };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
