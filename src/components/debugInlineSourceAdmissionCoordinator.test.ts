import { describe, expect, it } from "vitest";
import type * as Monaco from "monaco-editor";
import { MAX_DEBUG_INLINE_SOURCE_BYTES } from "../domain/debugInlineValues";
import {
  DebugInlineSourceAdmissionCoordinator,
  MAX_DEBUG_INLINE_ADMISSION_SOURCE_BYTES,
  MAX_DEBUG_INLINE_SOURCE_ADMISSIONS,
} from "./debugInlineSourceAdmissionCoordinator";

const owner = { rootKey: "/workspace", sessionId: 4, pauseGeneration: 2, frameId: 11 };
const model = {} as Monaco.editor.ITextModel;

describe("DebugInlineSourceAdmissionCoordinator", () => {
  it("shares an immutable clean admission and keeps invalidation across surfaces", () => {
    const coordinator = new DebugInlineSourceAdmissionCoordinator();
    const input = {
      dirty: false,
      model,
      modelSource: "const value = 1;",
      owner,
      path: "/workspace/main.ts",
      source: "const value = 1;",
    };
    expect(coordinator.admit(input)).toBe(true);
    expect(coordinator.admit(input)).toBe(true);
    expect(coordinator.admit({ ...input, dirty: true, source: "const value = 2;" })).toBe(false);
    expect(coordinator.admit(input)).toBe(false);
  });

  it("removes older same-root pause ownership without disturbing another root", () => {
    const coordinator = new DebugInlineSourceAdmissionCoordinator();
    const admit = (candidateOwner: typeof owner, path: string) =>
      coordinator.admit({
        dirty: false,
        model,
        modelSource: path,
        owner: candidateOwner,
        path,
        source: path,
      });
    expect(admit(owner, "/workspace/one.ts")).toBe(true);
    expect(admit({ ...owner, rootKey: "/other" }, "/other/one.ts")).toBe(true);
    expect(admit({ ...owner, pauseGeneration: 3 }, "/workspace/two.ts")).toBe(true);
    expect(coordinator.size).toBe(2);
  });

  it("retains frame admissions across A to B to A switches in the same pause", () => {
    const coordinator = new DebugInlineSourceAdmissionCoordinator();
    const input = {
      dirty: false,
      model,
      modelSource: "const a = 1;",
      owner,
      path: "/workspace/a.ts",
      source: "const a = 1;",
    };
    expect(coordinator.admit(input)).toBe(true);
    expect(
      coordinator.admit({
        ...input,
        modelSource: "const b = 1;",
        owner: { ...owner, frameId: 12 },
        path: "/workspace/b.ts",
        source: "const b = 1;",
      }),
    ).toBe(true);
    expect(
      coordinator.admit({
        ...input,
        dirty: true,
        modelSource: "const a = 2;",
        source: "const a = 2;",
      }),
    ).toBe(false);
    expect(coordinator.admit(input)).toBe(false);
  });

  it("bounds retained entries and total UTF-8 source bytes and supports explicit cleanup", () => {
    const coordinator = new DebugInlineSourceAdmissionCoordinator(2, 8);
    const admit = (index: number, source: string) =>
      coordinator.admit({
        dirty: false,
        model,
        modelSource: source,
        owner: { ...owner, rootKey: `/workspace-${index}` },
        path: `/workspace-${index}/main.ts`,
        source,
      });
    expect(admit(0, "é")).toBe(true);
    expect(admit(1, "1234")).toBe(true);
    expect(admit(2, "5678")).toBe(false);
    expect(admit(0, "é")).toBe(true);
    expect(coordinator.size).toBe(2);
    expect(coordinator.sourceBytes).toBeLessThanOrEqual(8);
    coordinator.clear();
    expect(coordinator.size).toBe(0);
    expect(coordinator.sourceBytes).toBe(0);
  });

  it("uses the shared production caps", () => {
    const coordinator = new DebugInlineSourceAdmissionCoordinator();
    expect(coordinator.maximumEntries).toBe(MAX_DEBUG_INLINE_SOURCE_ADMISSIONS);
    expect(coordinator.maximumSourceBytes).toBe(MAX_DEBUG_INLINE_ADMISSION_SOURCE_BYTES);
    expect(coordinator.maximumSourceBytes).toBe(
      MAX_DEBUG_INLINE_SOURCE_ADMISSIONS * MAX_DEBUG_INLINE_SOURCE_BYTES,
    );
  });
});
