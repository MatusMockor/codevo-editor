import { describe, expect, it } from "vitest";
import { environmentServerStatus } from "./environmentServerStatus";

describe("environmentServerStatus", () => {
  it("maps connection state and attempt phase to a closed status", () => {
    expect(environmentServerStatus(true, "idle", null)).toEqual({
      kind: "connected",
      label: "Connected",
    });
    expect(environmentServerStatus(false, "idle", "stale failure")).toEqual({
      kind: "disconnected",
      label: "Disconnected",
    });
    expect(environmentServerStatus(false, "connecting", null)).toEqual({
      kind: "connecting",
      label: "Connecting…",
    });
    expect(environmentServerStatus(true, "failed", "late failure").kind).toBe("connected");
  });

  it("shows a bounded failure reason and a fallback when none is known", () => {
    expect(environmentServerStatus(false, "failed", "  ").label).toBe("Could not connect");
    expect(environmentServerStatus(false, "failed", "server unreachable").label).toBe(
      "Could not connect - server unreachable",
    );
    const label = environmentServerStatus(false, "failed", "é".repeat(500)).label;
    expect(label).toBe(`Could not connect - ${"é".repeat(160)}…`);
  });
});
