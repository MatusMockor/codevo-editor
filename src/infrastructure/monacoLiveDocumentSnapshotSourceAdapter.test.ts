import type * as Monaco from "monaco-editor";
import { describe, expect, it, vi } from "vitest";
import type { LiveDocumentSnapshotReadExpectation } from "../application/liveDocumentSnapshotSourcePort";
import { createMonacoLiveDocumentSnapshotSource } from "./monacoLiveDocumentSnapshotSourceAdapter";

interface ModelHarness {
  alternativeVersionId: number;
  content: string;
  current: boolean;
  disposed: boolean;
  readonly getValue: ReturnType<typeof vi.fn<() => string>>;
  model: Monaco.editor.ITextModel;
  onGetValue: (() => void) | null;
  throwMetadata: boolean;
  versionId: number;
}

function modelHarness(content = "const value = 1;\n"): ModelHarness {
  const harness: ModelHarness = {
    alternativeVersionId: 1,
    content,
    current: true,
    disposed: false,
    getValue: vi.fn<() => string>(),
    model: null as unknown as Monaco.editor.ITextModel,
    onGetValue: null,
    throwMetadata: false,
    versionId: 1,
  };
  harness.getValue.mockImplementation(() => {
    const value = harness.content;
    const callback = harness.onGetValue;
    harness.onGetValue = null;
    callback?.();
    return value;
  });
  harness.model = {
    getAlternativeVersionId: () => {
      if (harness.throwMetadata) throw new Error("metadata failed");
      return harness.alternativeVersionId;
    },
    getValue: harness.getValue,
    getValueLength: () => {
      if (harness.throwMetadata) throw new Error("metadata failed");
      return harness.content.length;
    },
    getVersionId: () => {
      if (harness.throwMetadata) throw new Error("metadata failed");
      return harness.versionId;
    },
    isDisposed: () => harness.disposed,
  } as unknown as Monaco.editor.ITextModel;
  return harness;
}

function expectation(
  source: ReturnType<typeof createMonacoLiveDocumentSnapshotSource>,
  overrides: Partial<LiveDocumentSnapshotReadExpectation> = {},
): LiveDocumentSnapshotReadExpectation {
  const probe = source.probe();
  if (probe.status !== "available") throw new Error("source unavailable");
  return {
    alternativeVersionId: probe.alternativeVersionId,
    maxUtf16Units: probe.utf16Length,
    modelAuthority: source.modelAuthority,
    modelVersionId: probe.modelVersionId,
    sourceAuthority: source.sourceAuthority,
    utf16Length: probe.utf16Length,
    ...overrides,
  };
}

function sourceFor(harness: ModelHarness) {
  return createMonacoLiveDocumentSnapshotSource({
    isCurrentModel: (candidate) => harness.current && candidate === harness.model,
    model: harness.model,
    modelAuthority: Object.freeze({}),
  });
}

describe("Monaco live document snapshot source adapter", () => {
  it("reads every external registration field exactly once", () => {
    const harness = modelHarness();
    const modelAuthority = Object.freeze({});
    const reads = {
      isCurrentModel: 0,
      model: 0,
      modelAuthority: 0,
    };
    const registration = {
      get isCurrentModel() {
        reads.isCurrentModel += 1;
        return (candidate: Monaco.editor.ITextModel) => candidate === harness.model;
      },
      get model() {
        reads.model += 1;
        return harness.model;
      },
      get modelAuthority() {
        reads.modelAuthority += 1;
        return modelAuthority;
      },
    };

    const source = createMonacoLiveDocumentSnapshotSource(registration);
    expect(source.probe().status).toBe("available");
    expect(source.readFullText(expectation(source)).text).toBe(harness.content);
    expect(reads).toEqual({
      isCurrentModel: 1,
      model: 1,
      modelAuthority: 1,
    });
  });

  it("closes over the first model identity from an alternating getter", () => {
    const first = modelHarness("first");
    const second = modelHarness("second");
    let modelReads = 0;
    const source = createMonacoLiveDocumentSnapshotSource({
      isCurrentModel: (candidate) => candidate === first.model,
      get model() {
        modelReads += 1;
        return modelReads === 1 ? first.model : second.model;
      },
      modelAuthority: Object.freeze({}),
    });

    expect(source.readFullText(expectation(source)).text).toBe("first");
    expect(modelReads).toBe(1);
    expect(first.getValue).toHaveBeenCalledTimes(1);
    expect(second.getValue).not.toHaveBeenCalled();
  });

  it.each([1, 2] as const)(
    "contains a registration getter configured to throw on access %i",
    (throwOnAccess) => {
      const harness = modelHarness();
      let reads = 0;
      const registration = {
        isCurrentModel: (candidate: Monaco.editor.ITextModel) => candidate === harness.model,
        get model() {
          reads += 1;
          if (reads === throwOnAccess) throw new Error("model getter failed");
          return harness.model;
        },
        modelAuthority: Object.freeze({}),
      };

      if (throwOnAccess === 1) {
        expect(() => createMonacoLiveDocumentSnapshotSource(registration)).toThrow(
          /Invalid Monaco/,
        );
      } else {
        const source = createMonacoLiveDocumentSnapshotSource(registration);
        expect(source.probe().status).toBe("available");
      }
      expect(reads).toBe(1);
    },
  );

  it("exposes closed stable authorities and probes without materializing text", () => {
    const harness = modelHarness();
    const source = sourceFor(harness);

    expect(Object.isFrozen(source)).toBe(true);
    expect(Object.isFrozen(source.sourceAuthority)).toBe(true);
    expect(source.probe()).toEqual({
      alternativeVersionId: 1,
      modelVersionId: 1,
      status: "available",
      utf16Length: harness.content.length,
    });
    expect(harness.getValue).not.toHaveBeenCalled();
    expect(source.modelAuthority).toBe(source.modelAuthority);
    expect(source.sourceAuthority).toBe(source.sourceAuthority);
  });

  it("reads a 1 MiB model exactly once from one synchronous version boundary", () => {
    const harness = modelHarness("x".repeat(1024 * 1024));
    const source = sourceFor(harness);
    const read = source.readFullText(expectation(source));

    expect(read.text).toHaveLength(1024 * 1024);
    expect(read.utf16Length).toBe(1024 * 1024);
    expect(read.modelAuthority).toBe(source.modelAuthority);
    expect(read.sourceAuthority).toBe(source.sourceAuthority);
    expect(harness.getValue).toHaveBeenCalledTimes(1);
  });

  it.each(["disposed", "replaced", "metadata-throw"] as const)(
    "fails closed when the exact model is %s",
    (failure) => {
      const harness = modelHarness();
      const source = sourceFor(harness);
      const readExpectation = expectation(source);
      if (failure === "disposed") harness.disposed = true;
      if (failure === "replaced") harness.current = false;
      if (failure === "metadata-throw") harness.throwMetadata = true;

      expect(source.probe()).toEqual({ status: "unavailable" });
      expect(() => source.readFullText(readExpectation)).toThrow(/stale or unavailable/);
      expect(harness.getValue).not.toHaveBeenCalled();
    },
  );

  it.each([
    { modelVersionId: 2 },
    { alternativeVersionId: 2 },
    { utf16Length: 1 },
    { maxUtf16Units: 1 },
    { modelAuthority: Object.freeze({}) },
    { sourceAuthority: Object.freeze({}) },
  ] satisfies ReadonlyArray<Partial<LiveDocumentSnapshotReadExpectation>>)(
    "rejects a mismatched or bounded expectation before getValue: %o",
    (override) => {
      const harness = modelHarness();
      const source = sourceFor(harness);

      expect(() => source.readFullText(expectation(source, override))).toThrow();
      expect(harness.getValue).not.toHaveBeenCalled();
    },
  );

  it("rejects a mutation or disposal during getValue after exactly one materialization", () => {
    const harness = modelHarness();
    const source = sourceFor(harness);
    const readExpectation = expectation(source);
    harness.onGetValue = () => {
      harness.content += "changed";
      harness.versionId += 1;
      harness.alternativeVersionId += 1;
      harness.disposed = true;
    };

    expect(() => source.readFullText(readExpectation)).toThrow(/changed during/);
    expect(harness.getValue).toHaveBeenCalledTimes(1);
  });

  it("propagates a Monaco getValue failure without retrying the materialization", () => {
    const harness = modelHarness();
    const source = sourceFor(harness);
    const readExpectation = expectation(source);
    harness.getValue.mockImplementationOnce(() => {
      throw new Error("getValue failed");
    });

    expect(() => source.readFullText(readExpectation)).toThrow(/getValue failed/);
    expect(harness.getValue).toHaveBeenCalledTimes(1);
  });

  it("captures EOL and flush-style mutations only after their versions advance", () => {
    const harness = modelHarness("a\nb\n");
    const source = sourceFor(harness);

    harness.content = "a\r\nb\r\n";
    harness.versionId = 2;
    harness.alternativeVersionId = 2;
    expect(source.readFullText(expectation(source))).toMatchObject({
      alternativeVersionId: 2,
      modelVersionId: 2,
      text: "a\r\nb\r\n",
      utf16Length: 6,
    });

    harness.content = "flushed";
    harness.versionId = 3;
    harness.alternativeVersionId = 3;
    expect(source.readFullText(expectation(source))).toMatchObject({
      alternativeVersionId: 3,
      modelVersionId: 3,
      text: "flushed",
      utf16Length: 7,
    });
    expect(harness.getValue).toHaveBeenCalledTimes(2);
  });
});
