// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { click, mountUi, type MountedUi } from "../../../../ui/foundation/foundationTestSupport";
import { AgentGitBranchNotice } from "./AgentGitBranchNotice";

let ui: MountedUi | null = null;
afterEach(() => {
  ui?.unmount();
  ui = null;
});

const PATH = "/repo/.worktrees/branch-feat-x";

function renderWorktreeNotice(trusted: boolean, onCopyPath = vi.fn()): MountedUi {
  const mounted = mountUi();
  mounted.render(
    <AgentGitBranchNotice
      notice={{ kind: "worktree", text: `Created a worktree at ${PATH}`, path: PATH, trusted }}
      onCopyPath={onCopyPath}
      onDismiss={vi.fn()}
    />,
  );
  return mounted;
}

describe("AgentGitBranchNotice", () => {
  it("warns that an untrusted worktree needs trust before running scripts or agents", () => {
    ui = renderWorktreeNotice(false);

    const status = ui.host.querySelector('[role="status"]');
    expect(status?.textContent).toContain(`Created a worktree at ${PATH}`);
    expect(status?.textContent).toContain("This worktree is not trusted yet.");
    expect(status?.textContent).toContain("scripts or agents");
  });

  it("does not claim a trusted worktree is untrusted", () => {
    const onCopyPath = vi.fn();
    ui = renderWorktreeNotice(true, onCopyPath);

    expect(ui.host.textContent).not.toContain("not trusted");
    const copy = Array.from(ui.host.querySelectorAll("button")).find(
      (button) => button.textContent === "Copy path",
    );
    expect(copy).toBeDefined();
    click(copy as Element);
    expect(onCopyPath).toHaveBeenCalledWith(PATH);
  });

  it("renders errors as alerts without a trust message", () => {
    ui = mountUi();
    ui.render(
      <AgentGitBranchNotice
        notice={{ kind: "error", text: "Could not switch branches." }}
        onCopyPath={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(ui.host.querySelector('[role="alert"]')?.textContent).toBe("Could not switch branches.");
  });
});
