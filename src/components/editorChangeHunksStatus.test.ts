import { describe, expect, it } from "vitest";
import {
  editorChangeHunksStatus,
  SEMANTIC_HIGHLIGHTING_DISABLED_REASON,
} from "./editorChangeHunksStatus";

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
    ).toEqual({
      label: "Large file mode",
      title: `Smart analysis is limited. ${SEMANTIC_HIGHLIGHTING_DISABLED_REASON}`,
    });
  });

  it("reports the disabled semantic highlighting of a large document", () => {
    const largeDocumentStatus = {
      label: "Large file mode",
      title: "Smart analysis is limited.",
    };

    const status = editorChangeHunksStatus(largeDocumentStatus, { hunks: [], status: "ready" });

    expect(status?.title).toContain("Semantic highlighting is disabled");
  });

  it("keeps the reported large-document status referentially stable", () => {
    const largeDocumentStatus = {
      label: "Large file mode",
      title: "Smart analysis is limited.",
    };

    expect(editorChangeHunksStatus(largeDocumentStatus, { hunks: [], status: "ready" })).toBe(
      editorChangeHunksStatus(largeDocumentStatus, { hunks: [], status: "ready" }),
    );
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
