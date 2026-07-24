import { describe, expect, it } from "vitest";
import { createDebugBreakpointSynchronization } from "./debugBreakpointSynchronization";

describe("debug breakpoint synchronization", () => {
  it("accepts only the latest operation for a root and file", () => {
    const synchronization = createDebugBreakpointSynchronization();
    const first = synchronization.begin("/one", 1, "/one/app.ts");
    const second = synchronization.begin("/one", 1, "/one/app.ts");
    expect(synchronization.isLatest(first)).toBe(false);
    expect(synchronization.isLatest(second)).toBe(true);
  });

  it("invalidates all pending operations for a root", () => {
    const synchronization = createDebugBreakpointSynchronization();
    const token = synchronization.begin("/one", 1, "/one/app.ts");
    synchronization.invalidateRoot("/one");
    expect(synchronization.isLatest(token)).toBe(false);
  });
});
