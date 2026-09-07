import { describe, expect, it } from "vitest";
import { agentBranchCheckoutBlockedReason as reason } from "./agentBranchCheckoutPolicy";

describe("agent working branch checkout", () => {
  const dirty = { path: "/projects/app/file.ts", content: "draft", savedContent: "saved" };
  it("preserves unsaved documents in the selected checkout", () => {
    expect(reason("/projects/app", [dirty], [], false)).toContain("Save your unsaved files");
    expect(reason("/projects/app", [{ ...dirty, content: "saved" }], [], false)).toBeNull();
  });
  it("blocks live unsaved edits when the legacy document still looks clean", () => {
    const clean = { ...dirty, content: "saved" };
    expect(reason("/projects/app", [clean], [], false, () => true)).toContain(
      "Save your unsaved files",
    );
    expect(reason("/projects/app-copy", [clean], [], false, () => true)).toBeNull();
    expect(reason("/projects/app", [clean], [], false, () => false)).toBeNull();
  });
  it("does not block a sibling repository or a separate worktree", () => {
    expect(
      reason("/projects/app-copy", [dirty], [{ rootPath: "/projects/app", running: true }], false),
    ).toBeNull();
    expect(
      reason("/worktrees/app", [dirty], [{ rootPath: "/projects/app", running: true }], false),
    ).toBeNull();
  });
  it("blocks active agents sharing this checkout, including another thread", () => {
    expect(
      reason("/projects/app", [], [{ rootPath: "/projects/app", running: true }], false),
    ).toContain("Stop the agent");
    expect(
      reason("/projects/app", [], [{ rootPath: "/projects/app", running: false }], false),
    ).toBeNull();
  });
  it("fails closed while editor or dispatch state is unsettled", () => {
    expect(reason("/projects/app", undefined, [], false)).not.toBeNull();
    expect(reason("/projects/app", [], [], true)).not.toBeNull();
  });
});
