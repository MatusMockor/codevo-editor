import type * as Monaco from "monaco-editor";
import { describe, expect, it, vi } from "vitest";
import { workspaceModelUri } from "./phpMonacoDocumentContext";
import { createMonacoModelRegistry } from "./monacoModelRegistry";

interface ModelHarness {
  readonly dispose: () => void;
  readonly isDisposed: ReturnType<typeof vi.fn<() => boolean>>;
  readonly model: Monaco.editor.ITextModel;
}

interface MonacoHarness {
  readonly emitCreated: (model: Monaco.editor.ITextModel) => void;
  readonly getModels: ReturnType<typeof vi.fn<() => Monaco.editor.ITextModel[]>>;
  readonly monaco: typeof Monaco;
}

describe("MonacoModelRegistry", () => {
  it.each([1, 100, 1_024])(
    "performs one exact candidate check per lookup across %i registered models/results",
    (count) => {
      const models = Array.from({ length: count }, (_, index) =>
        createWorkspaceModel("/workspace", `/workspace/src/model-${index}.ts`),
      );
      const harness = createMonacoHarness(models.map(({ model }) => model));
      const registry = createMonacoModelRegistry(harness.monaco);

      models.forEach(({ isDisposed }) => isDisposed.mockClear());
      for (let index = 0; index < count; index += 1) {
        expect(registry.modelForPath("/workspace", `/workspace/src/model-${index}.ts`)).toBe(
          models[index]?.model,
        );
      }

      expect(harness.getModels).toHaveBeenCalledTimes(1);
      expect(
        models.reduce((checks, { isDisposed }) => checks + isDisposed.mock.calls.length, 0),
      ).toBe(count);
    },
  );

  it.each([1, 2, 4])(
    "keeps %i split-pane lookups constant with 100 retained models",
    (paneCount) => {
      const models = Array.from({ length: 100 }, (_, index) =>
        createWorkspaceModel("/workspace", `/workspace/src/retained-${index}.ts`),
      );
      const harness = createMonacoHarness(models.map(({ model }) => model));
      const registry = createMonacoModelRegistry(harness.monaco);
      models.forEach(({ isDisposed }) => isDisposed.mockClear());

      const target = models[73]!;
      for (let pane = 0; pane < paneCount; pane += 1) {
        expect(registry.modelForPath("/workspace", "/workspace/src/retained-73.ts")).toBe(
          target.model,
        );
      }

      expect(harness.getModels).toHaveBeenCalledTimes(1);
      expect(
        models.reduce((checks, { isDisposed }) => checks + isDisposed.mock.calls.length, 0),
      ).toBe(paneCount);
      expect(target.isDisposed).toHaveBeenCalledTimes(paneCount);
    },
  );

  it.each([1, 2, 4])("reference-counts %i exact split/Peek leases", (leaseCount) => {
    const retained = createWorkspaceModel("/workspace", "/workspace/src/peek.ts");
    const harness = createMonacoHarness([retained.model]);
    const registry = createMonacoModelRegistry(harness.monaco);
    const leases = [
      registry.registerTransientModel(retained.model),
      ...Array.from({ length: leaseCount - 1 }, () => registry.leaseTransientModel(retained.model)),
    ];

    expect(leases.every((lease) => lease?.active)).toBe(true);
    expect(registry.hasActiveLease(retained.model)).toBe(true);
    leases.slice(0, -1).forEach((lease) => lease?.release());
    expect(registry.hasActiveLease(retained.model)).toBe(true);

    leases[leases.length - 1]?.release();
    expect(registry.hasActiveLease(retained.model)).toBe(false);
    leases.forEach((lease) => lease?.release());
    expect(registry.hasActiveLease(retained.model)).toBe(false);
  });

  it("invalidates 100 transient leases on exact model disposal without stale reuse", () => {
    const retained = Array.from({ length: 100 }, (_, index) =>
      createWorkspaceModel("/workspace", `/workspace/src/transient-${index}.ts`),
    );
    const harness = createMonacoHarness(retained.map(({ model }) => model));
    const registry = createMonacoModelRegistry(harness.monaco);
    const leases = retained.map(({ model }) => registry.registerTransientModel(model));

    expect(leases.every((lease) => lease?.active)).toBe(true);
    retained.forEach(({ dispose }) => dispose());

    expect(leases.every((lease) => lease?.active === false)).toBe(true);
    expect(retained.every(({ model }) => !registry.hasActiveLease(model))).toBe(true);
  });

  it("invalidates every exact owner lease when a shared transient is externally disposed", () => {
    const transient = createWorkspaceModel("/workspace", "/workspace/src/external.ts");
    const harness = createMonacoHarness([transient.model]);
    const registry = createMonacoModelRegistry(harness.monaco);
    const firstLease = registry.registerTransientModel(transient.model);
    const secondLease = registry.leaseTransientModel(transient.model);

    transient.dispose();

    expect(firstLease?.active).toBe(false);
    expect(secondLease?.active).toBe(false);
    expect(firstLease?.release()).toBe(false);
    expect(secondLease?.release()).toBe(false);
    expect(registry.hasActiveLease(transient.model)).toBe(false);
    expect(registry.isTransientModel(transient.model)).toBe(false);
  });

  it("removes disposed models and never reuses them after a same-URI replacement", () => {
    const first = createWorkspaceModel("/workspace", "/workspace/src/replaced.ts");
    const harness = createMonacoHarness([first.model]);
    const registry = createMonacoModelRegistry(harness.monaco);

    expect(registry.modelForPath("/workspace", "/workspace/src/replaced.ts")).toBe(first.model);
    first.dispose();
    expect(registry.modelForPath("/workspace", "/workspace/src/replaced.ts")).toBeNull();

    const replacement = createWorkspaceModel("/workspace", "/workspace/src/replaced.ts");
    harness.emitCreated(replacement.model);

    expect(registry.modelForPath("/workspace", "/workspace/src/replaced.ts")).toBe(
      replacement.model,
    );
    expect(registry.modelForUri(replacement.model.uri)).toBe(replacement.model);
  });

  it("mints a stable opaque authority and rotates it on same-URI replacement", () => {
    const first = createWorkspaceModel("/workspace", "/workspace/src/authority.ts");
    const harness = createMonacoHarness([first.model]);
    const registry = createMonacoModelRegistry(harness.monaco);
    const firstAuthority = registry.modelAuthority(first.model);

    expect(firstAuthority).not.toBeNull();
    expect(registry.modelAuthority(first.model)).toBe(firstAuthority);
    first.dispose();
    expect(registry.modelAuthority(first.model)).toBeNull();

    const replacement = createWorkspaceModel("/workspace", "/workspace/src/authority.ts");
    harness.emitCreated(replacement.model);
    const replacementAuthority = registry.modelAuthority(replacement.model);
    expect(replacementAuthority).not.toBeNull();
    expect(replacementAuthority).not.toBe(firstAuthority);
  });

  it("preserves exact workspace authority across A-B-A lookups", () => {
    const workspaceA = createWorkspaceModel("/workspace-a", "/workspace-a/src/shared.ts");
    const workspaceB = createWorkspaceModel("/workspace-b", "/workspace-b/src/shared.ts");
    const harness = createMonacoHarness([workspaceA.model, workspaceB.model]);
    const registry = createMonacoModelRegistry(harness.monaco);

    expect(registry.modelForPath("/workspace-a", "/workspace-a/src/shared.ts")).toBe(
      workspaceA.model,
    );
    expect(registry.modelForPath("/workspace-b", "/workspace-b/src/shared.ts")).toBe(
      workspaceB.model,
    );
    expect(registry.modelForPath("/workspace-a", "/workspace-a/src/shared.ts")).toBe(
      workspaceA.model,
    );
  });

  it("does not let a stale A lease release a replacement model's lease after A-B-A", () => {
    const firstA = createWorkspaceModel("/workspace-a", "/workspace-a/src/replaced.ts");
    const workspaceB = createWorkspaceModel("/workspace-b", "/workspace-b/src/replaced.ts");
    const harness = createMonacoHarness([firstA.model, workspaceB.model]);
    const registry = createMonacoModelRegistry(harness.monaco);
    const staleLease = registry.registerTransientModel(firstA.model);
    firstA.dispose();

    const nextA = createWorkspaceModel("/workspace-a", "/workspace-a/src/replaced.ts");
    harness.emitCreated(nextA.model);
    const currentLease = registry.registerTransientModel(nextA.model);
    staleLease?.release();

    expect(staleLease?.active).toBe(false);
    expect(currentLease?.active).toBe(true);
    expect(registry.hasActiveLease(nextA.model)).toBe(true);
    expect(registry.modelForPath("/workspace-a", "/workspace-a/src/replaced.ts")).toBe(nextA.model);
  });

  it("unions exact retention publishers and releases only the matching host authority", () => {
    const workspaceA = createWorkspaceModel("/workspace-a", "/workspace-a/src/retained.ts");
    const workspaceB = createWorkspaceModel("/workspace-b", "/workspace-b/src/retained.ts");
    const harness = createMonacoHarness([workspaceA.model, workspaceB.model]);
    const registry = createMonacoModelRegistry(harness.monaco);
    const publisherA = registry.createRuntimeRetentionPublisher();
    const publisherB = registry.createRuntimeRetentionPublisher();

    publisherA.replace("/workspace-a", new Set(["/workspace-a/src/retained.ts"]));
    publisherB.replace("/workspace-b", new Set(["/workspace-b/src/retained.ts"]));
    expect(registry.isRuntimeRetained(workspaceA.model)).toBe(true);
    expect(registry.isRuntimeRetained(workspaceB.model)).toBe(true);

    publisherA.release();
    expect(registry.isRuntimeRetained(workspaceA.model)).toBe(false);
    expect(registry.isRuntimeRetained(workspaceB.model)).toBe(true);
  });

  it("does not let a rootless same-path publisher retain a rooted workspace model", () => {
    const rooted = createWorkspaceModel("/workspace", "/workspace/src/rooted.ts");
    const loose = createFileModel("/loose.ts");
    const harness = createMonacoHarness([rooted.model, loose.model]);
    const registry = createMonacoModelRegistry(harness.monaco);
    const publisher = registry.createRuntimeRetentionPublisher();

    publisher.replace(null, new Set(["/workspace/src/rooted.ts", "/loose.ts"]));

    expect(registry.isRuntimeRetained(rooted.model)).toBe(false);
    expect(registry.isRuntimeRetained(loose.model)).toBe(true);
  });

  it("requires a new retention publisher after A generation teardown", () => {
    const firstA = createWorkspaceModel("/workspace-a", "/workspace-a/src/generation.ts");
    const harness = createMonacoHarness([firstA.model]);
    const registry = createMonacoModelRegistry(harness.monaco);
    const stalePublisher = registry.createRuntimeRetentionPublisher();
    stalePublisher.replace("/workspace-a", new Set(["/workspace-a/src/generation.ts"]));
    expect(registry.isRuntimeRetained(firstA.model)).toBe(true);

    firstA.dispose();
    const nextA = createWorkspaceModel("/workspace-a", "/workspace-a/src/generation.ts");
    harness.emitCreated(nextA.model);

    expect(registry.isRuntimeRetained(nextA.model)).toBe(false);
    stalePublisher.release();
    const currentPublisher = registry.createRuntimeRetentionPublisher();
    currentPublisher.replace("/workspace-a", new Set(["/workspace-a/src/generation.ts"]));
    expect(registry.isRuntimeRetained(nextA.model)).toBe(true);
  });

  it("shares one live model across panes and supports an exact transient exclusion fallback", () => {
    const transient = createWorkspaceModel("/workspace", "/workspace/src/shared.ts");
    const openModel = createWorkspaceModel("/workspace", "/workspace/src/shared.ts");
    const harness = createMonacoHarness([transient.model, openModel.model]);
    const registry = createMonacoModelRegistry(harness.monaco);

    expect(registry.modelForPath("/workspace", "/workspace/src/shared.ts")).toBe(transient.model);
    expect(
      registry.modelForPath("/workspace", "/workspace/src/shared.ts", {
        exclude: transient.model,
      }),
    ).toBe(openModel.model);
    expect(registry.modelForPath("/workspace", "/workspace/src/shared.ts")).toBe(transient.model);
    expect(transient.isDisposed()).toBe(false);
  });

  it("stops tracking creation and clears lookups without disposing Monaco-owned models", () => {
    const retained = createWorkspaceModel("/workspace", "/workspace/src/retained.ts");
    const harness = createMonacoHarness([retained.model]);
    const registry = createMonacoModelRegistry(harness.monaco);

    registry.dispose();
    const late = createWorkspaceModel("/workspace", "/workspace/src/late.ts");
    harness.emitCreated(late.model);

    expect(registry.modelForPath("/workspace", "/workspace/src/retained.ts")).toBeNull();
    expect(registry.modelForPath("/workspace", "/workspace/src/late.ts")).toBeNull();
    expect(retained.isDisposed()).toBe(false);
  });

  it("uses exact Monaco URI lookup when a minimal host has no creation event", () => {
    const opened = createWorkspaceModel("/workspace", "/workspace/src/opened-late.ts");
    const models: Monaco.editor.ITextModel[] = [];
    const getModels = vi.fn(() => [...models]);
    const getModel = vi.fn((uri: Monaco.Uri) =>
      uri.toString() === opened.model.uri.toString() ? opened.model : null,
    );
    const monaco = {
      Uri: {
        file: (path: string) => ({ toString: () => `file://${path}` }),
        parse: (value: string) => ({ toString: () => value }),
      },
      editor: { getModel, getModels },
    } as unknown as typeof Monaco;
    const registry = createMonacoModelRegistry(monaco);

    expect(registry.modelForPath("/workspace", "/workspace/src/opened-late.ts")).toBe(opened.model);
    expect(getModels).toHaveBeenCalledTimes(1);
    expect(getModel).toHaveBeenCalledTimes(1);
  });
});

function createWorkspaceModel(rootPath: string, path: string): ModelHarness {
  const uriString = workspaceModelUri(rootPath, path);
  if (!uriString) {
    throw new Error(`Expected a workspace URI for ${path}`);
  }

  let disposed = false;
  const disposeListeners = new Set<() => void>();
  const isDisposed = vi.fn(() => disposed);
  const uri = {
    fsPath: path,
    path,
    scheme: "codevo-workspace",
    toString: () => uriString,
  } as Monaco.Uri;
  const model = {
    isDisposed,
    onWillDispose: (listener: () => void) => {
      disposeListeners.add(listener);
      return {
        dispose: () => disposeListeners.delete(listener),
      };
    },
    uri,
  } as unknown as Monaco.editor.ITextModel;

  return {
    dispose: () => {
      if (disposed) {
        return;
      }
      disposeListeners.forEach((listener) => listener());
      disposed = true;
    },
    isDisposed,
    model,
  };
}

function createFileModel(path: string): ModelHarness {
  let disposed = false;
  const disposeListeners = new Set<() => void>();
  const isDisposed = vi.fn(() => disposed);
  const model = {
    isDisposed,
    onWillDispose: (listener: () => void) => {
      disposeListeners.add(listener);
      return { dispose: () => disposeListeners.delete(listener) };
    },
    uri: {
      fsPath: path,
      path,
      scheme: "file",
      toString: () => `file://${path}`,
    },
  } as unknown as Monaco.editor.ITextModel;

  return {
    dispose: () => {
      if (disposed) {
        return;
      }
      disposeListeners.forEach((listener) => listener());
      disposed = true;
    },
    isDisposed,
    model,
  };
}

function createMonacoHarness(initialModels: Monaco.editor.ITextModel[]): MonacoHarness {
  const models = [...initialModels];
  const createListeners = new Set<(model: Monaco.editor.ITextModel) => void>();
  const getModels = vi.fn(() => [...models]);
  const monaco = {
    editor: {
      getModels,
      onDidCreateModel: (listener: (model: Monaco.editor.ITextModel) => void) => {
        createListeners.add(listener);
        return {
          dispose: () => createListeners.delete(listener),
        };
      },
    },
  } as unknown as typeof Monaco;

  return {
    emitCreated: (model) => {
      models.push(model);
      createListeners.forEach((listener) => listener(model));
    },
    getModels,
    monaco,
  };
}
