import { describe, expect, it } from "vitest";
import { editorChangeHunksStatus } from "./editorChangeHunksStatus";

describe("editorChangeHunksStatus", () => {
  it("keeps the active large-document status authoritative", () => {
    const largeDocumentStatus = {
      label: "Large file mode",
      title: "Smart analysis is limited.",
    };

    expect(
      editorChangeHunksStatus(largeDocumentStatus, {
        hunks: [],
        message: "worker failed",
        status: "error",
      }),
    ).toBe(largeDocumentStatus);
  });

  it("presents degraded and failed change-marker computation", () => {
    expect(
      editorChangeHunksStatus(null, {
        hunks: [],
        reason: "large-file",
        status: "degraded",
      }),
    ).toMatchObject({ label: "Change markers limited" });
    expect(
      editorChangeHunksStatus(null, {
        hunks: [],
        message: "worker failed",
        status: "error",
      }),
    ).toEqual({
      label: "Change markers unavailable",
      title: "worker failed",
    });
  });

  it("stays silent for normal computation states", () => {
    expect(editorChangeHunksStatus(null, { hunks: [], status: "ready" })).toBeNull();
  });
});
