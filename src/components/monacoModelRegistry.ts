import type * as Monaco from "monaco-editor";
import {
  modelMatchesWorkspacePath,
  modelPath,
  toWorkspaceMonacoUri,
  workspacePathKey,
  workspacePathKeyForModel,
} from "./phpMonacoDocumentContext";

export interface MonacoModelLookupOptions {
  readonly exclude?: Monaco.editor.ITextModel;
}

export interface MonacoModelLookup {
  createRuntimeRetentionPublisher(): MonacoRuntimeRetentionPublisher;
  hasActiveLease(model: Monaco.editor.ITextModel): boolean;
  isRuntimeRetained(model: Monaco.editor.ITextModel): boolean;
  isTransientModel(model: Monaco.editor.ITextModel): boolean;
  leaseTransientModel(model: Monaco.editor.ITextModel): MonacoModelLease | null;
  modelAuthority(model: Monaco.editor.ITextModel): object | null;
  registerTransientModel(model: Monaco.editor.ITextModel): MonacoModelLease | null;
  modelForPath(
    workspaceRoot: string | null,
    path: string,
    options?: MonacoModelLookupOptions,
  ): Monaco.editor.ITextModel | null;
  modelForUri(uri: Monaco.Uri): Monaco.editor.ITextModel | null;
}

export interface MonacoModelLease {
  readonly active: boolean;
  release(): boolean;
}

export interface MonacoRuntimeRetentionPublisher {
  readonly active: boolean;
  release(): void;
  replace(workspaceRoot: string | null, paths: ReadonlySet<string>): void;
}

export interface MonacoModelRegistry extends MonacoModelLookup {
  dispose(): void;
}

type ModelBucket = Set<Monaco.editor.ITextModel>;

interface RegisteredModel {
  readonly authority: object;
  readonly disposeSubscription: Monaco.IDisposable;
  readonly generation: number;
  readonly nativePath: string | null;
  readonly uri: string;
  readonly workspaceKey: string | null;
}

const registryByMonaco = new WeakMap<typeof Monaco, MonacoModelLookup>();

export function monacoModelRegistry(monaco: typeof Monaco): MonacoModelLookup {
  const existing = registryByMonaco.get(monaco);
  if (existing) {
    return existing;
  }

  const registry = createMonacoModelRegistry(monaco);
  registryByMonaco.set(monaco, registry);
  return registry;
}

export function createMonacoModelRegistry(monaco: typeof Monaco): MonacoModelRegistry {
  const modelsByNativePath = new Map<string, ModelBucket>();
  const modelsByUri = new Map<string, Monaco.editor.ITextModel>();
  const modelsByWorkspaceKey = new Map<string, ModelBucket>();
  const leaseCounts = new Map<Monaco.editor.ITextModel, number>();
  const registrations = new Map<Monaco.editor.ITextModel, RegisteredModel>();
  const runtimeRetentionByPublisher = new Map<object, Set<Monaco.editor.ITextModel>>();
  const transientModels = new WeakSet<Monaco.editor.ITextModel>();
  let nextGeneration = 0;
  let disposed = false;

  const tracksCreations = typeof monaco.editor.onDidCreateModel === "function";
  const createSubscription = tracksCreations
    ? monaco.editor.onDidCreateModel(register)
    : { dispose: () => undefined };
  monaco.editor.getModels().forEach(register);

  function addToBucket(
    buckets: Map<string, ModelBucket>,
    key: string | null,
    model: Monaco.editor.ITextModel,
  ): void {
    if (key === null) {
      return;
    }

    const bucket = buckets.get(key) ?? new Set();
    bucket.add(model);
    buckets.set(key, bucket);
  }

  function removeFromBucket(
    buckets: Map<string, ModelBucket>,
    key: string | null,
    model: Monaco.editor.ITextModel,
  ): void {
    if (key === null) {
      return;
    }

    const bucket = buckets.get(key);
    bucket?.delete(model);
    if (bucket?.size === 0) {
      buckets.delete(key);
    }
  }

  function unregister(model: Monaco.editor.ITextModel): void {
    const registration = registrations.get(model);
    if (!registration) {
      return;
    }

    registrations.delete(model);
    leaseCounts.delete(model);
    transientModels.delete(model);
    runtimeRetentionByPublisher.forEach((retainedModels) => retainedModels.delete(model));
    registration.disposeSubscription.dispose();
    if (modelsByUri.get(registration.uri) === model) {
      modelsByUri.delete(registration.uri);
    }
    removeFromBucket(modelsByNativePath, registration.nativePath, model);
    removeFromBucket(modelsByWorkspaceKey, registration.workspaceKey, model);
  }

  function register(model: Monaco.editor.ITextModel): void {
    if (disposed || registrations.has(model) || model.isDisposed?.()) {
      return;
    }

    const uri = model.uri.toString();
    const nativePath = modelPath(model);
    const workspaceKey = workspacePathKeyForModel(model);
    const disposeSubscription =
      typeof model.onWillDispose === "function"
        ? model.onWillDispose(() => unregister(model))
        : { dispose: () => undefined };

    registrations.set(model, {
      authority: Object.freeze({}),
      disposeSubscription,
      generation: ++nextGeneration,
      nativePath,
      uri,
      workspaceKey,
    });
    modelsByUri.set(uri, model);
    addToBucket(modelsByNativePath, nativePath, model);
    addToBucket(modelsByWorkspaceKey, workspaceKey, model);
  }

  function firstLiveModel(
    bucket: ModelBucket | undefined,
    matches: (model: Monaco.editor.ITextModel) => boolean,
    exclude?: Monaco.editor.ITextModel,
  ): Monaco.editor.ITextModel | null {
    if (!bucket) {
      return null;
    }

    for (const model of bucket) {
      if (model === exclude) {
        continue;
      }
      if (model.isDisposed?.()) {
        unregister(model);
        continue;
      }
      if (matches(model)) {
        return model;
      }
    }
    return null;
  }

  function registerExactFallback(
    workspaceRoot: string | null,
    path: string,
  ): Monaco.editor.ITextModel | null {
    if (
      tracksCreations ||
      typeof monaco.editor.getModel !== "function" ||
      !monaco.Uri ||
      (!workspaceRoot && typeof monaco.Uri.file !== "function")
    ) {
      return null;
    }

    const uri = workspaceRoot
      ? toWorkspaceMonacoUri(monaco, workspaceRoot, path)
      : monaco.Uri.file(path);
    const model = uri ? monaco.editor.getModel(uri) : null;
    if (!model || model.isDisposed?.()) {
      return null;
    }

    register(model);
    return model;
  }

  function registeredModelForPath(
    workspaceRoot: string | null,
    path: string,
    options: MonacoModelLookupOptions,
  ): Monaco.editor.ITextModel | null {
    if (workspaceRoot) {
      const key = workspacePathKey(workspaceRoot, path);
      const workspaceModel = firstLiveModel(
        key ? modelsByWorkspaceKey.get(key) : undefined,
        (model) => modelMatchesWorkspacePath(model, workspaceRoot, path),
        options.exclude,
      );
      if (workspaceModel) {
        return workspaceModel;
      }

      return firstLiveModel(
        modelsByNativePath.get(path),
        (model) => modelMatchesWorkspacePath(model, workspaceRoot, path),
        options.exclude,
      );
    }

    return firstLiveModel(
      modelsByNativePath.get(path),
      (model) => modelPath(model) === path,
      options.exclude,
    );
  }

  function retainedModelsForPaths(
    workspaceRoot: string | null,
    paths: ReadonlySet<string>,
  ): Set<Monaco.editor.ITextModel> {
    const retainedModels = new Set<Monaco.editor.ITextModel>();
    const addMatchingModels = (
      bucket: ModelBucket | undefined,
      matches: (model: Monaco.editor.ITextModel) => boolean,
    ) => {
      if (!bucket) {
        return;
      }
      for (const model of bucket) {
        if (model.isDisposed?.()) {
          unregister(model);
        } else if (matches(model)) {
          retainedModels.add(model);
        }
      }
    };

    for (const path of paths) {
      if (workspaceRoot) {
        const key = workspacePathKey(workspaceRoot, path);
        addMatchingModels(key ? modelsByWorkspaceKey.get(key) : undefined, (model) =>
          modelMatchesWorkspacePath(model, workspaceRoot, path),
        );
        addMatchingModels(modelsByNativePath.get(path), (model) =>
          modelMatchesWorkspacePath(model, workspaceRoot, path),
        );
      } else {
        addMatchingModels(
          modelsByNativePath.get(path),
          (model) => workspacePathKeyForModel(model) === null && modelPath(model) === path,
        );
      }
    }
    return retainedModels;
  }

  function acquireLease(model: Monaco.editor.ITextModel): MonacoModelLease | null {
    if (disposed || model.isDisposed?.()) {
      return null;
    }

    register(model);
    const registration = registrations.get(model);
    if (!registration) {
      return null;
    }

    const generation = registration.generation;
    let active = true;
    leaseCounts.set(model, (leaseCounts.get(model) ?? 0) + 1);
    return {
      get active() {
        return (
          active &&
          registrations.get(model)?.generation === generation &&
          (leaseCounts.get(model) ?? 0) > 0
        );
      },
      release: () => {
        if (!active) {
          return false;
        }
        active = false;
        if (registrations.get(model)?.generation !== generation) {
          return false;
        }

        const count = leaseCounts.get(model) ?? 0;
        if (count <= 1) {
          leaseCounts.delete(model);
          return true;
        }

        leaseCounts.set(model, count - 1);
        return false;
      },
    };
  }

  return {
    dispose: () => {
      if (disposed) {
        return;
      }

      disposed = true;
      createSubscription.dispose();
      [...registrations.keys()].forEach(unregister);
      modelsByNativePath.clear();
      modelsByUri.clear();
      modelsByWorkspaceKey.clear();
      leaseCounts.clear();
      runtimeRetentionByPublisher.clear();
    },
    createRuntimeRetentionPublisher: () => {
      const publisher = {};
      let active = true;
      return {
        get active() {
          return active && !disposed;
        },
        release: () => {
          if (!active) {
            return;
          }
          active = false;
          runtimeRetentionByPublisher.delete(publisher);
        },
        replace: (workspaceRoot, paths) => {
          if (!active || disposed) {
            return;
          }
          if (!tracksCreations) {
            monaco.editor.getModels().forEach(register);
          }
          runtimeRetentionByPublisher.set(publisher, retainedModelsForPaths(workspaceRoot, paths));
        },
      };
    },
    hasActiveLease: (model) =>
      !disposed && registrations.has(model) && (leaseCounts.get(model) ?? 0) > 0,
    isRuntimeRetained: (model) => {
      if (disposed || !registrations.has(model)) {
        return false;
      }

      for (const retainedModels of runtimeRetentionByPublisher.values()) {
        if (retainedModels.has(model)) {
          return true;
        }
      }
      return false;
    },
    isTransientModel: (model) =>
      !disposed && registrations.has(model) && transientModels.has(model),
    leaseTransientModel: (model) =>
      !disposed && transientModels.has(model) ? acquireLease(model) : null,
    modelAuthority: (model) => {
      if (disposed || model.isDisposed?.()) {
        unregister(model);
        return null;
      }
      return registrations.get(model)?.authority ?? null;
    },
    modelForPath: (workspaceRoot, path, options = {}) => {
      if (disposed) {
        return null;
      }

      registerExactFallback(workspaceRoot, path);
      const registeredModel = registeredModelForPath(workspaceRoot, path, options);
      if (registeredModel || tracksCreations) {
        return registeredModel;
      }

      // Minimal Monaco test hosts can omit lifecycle events. Preserve their
      // legacy behavior with a lazy compatibility scan; production Monaco uses
      // the event-driven path above and never reaches this branch.
      monaco.editor.getModels().forEach(register);
      return registeredModelForPath(workspaceRoot, path, options);
    },
    modelForUri: (uri) => {
      if (disposed) {
        return null;
      }

      const key = uri.toString();
      let model = modelsByUri.get(key);
      if (!model && !tracksCreations && typeof monaco.editor.getModel === "function") {
        const exactModel = monaco.editor.getModel(uri);
        if (exactModel && !exactModel.isDisposed?.()) {
          register(exactModel);
          model = modelsByUri.get(key);
        }
      }
      if (!model) {
        return null;
      }
      if (model.isDisposed?.()) {
        unregister(model);
        return null;
      }
      return model;
    },
    registerTransientModel: (model) => {
      if (disposed || model.isDisposed?.()) {
        return null;
      }

      register(model);
      if (!registrations.has(model)) {
        return null;
      }
      transientModels.add(model);
      return acquireLease(model);
    },
  };
}
