// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { GitChangedFile, GitStatus } from "../../domain/git";
import { mountUi, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import {
  checkoutFileStatuses,
  useCheckoutFileStatuses,
  type CheckoutFileStatuses,
  type UseCheckoutFileStatusesOptions,
} from "./useCheckoutFileStatuses";

let ui: MountedUi | null = null;
const box: { current: CheckoutFileStatuses | null } = { current: null };

afterEach(() => {
  ui?.unmount();
  ui = null;
  box.current = null;
});

function change(path: string, status: GitChangedFile["status"]): GitChangedFile {
  return {
    isStaged: false,
    isUnversioned: status === "untracked",
    oldPath: null,
    oldRelativePath: null,
    path,
    relativePath: path.slice(path.lastIndexOf("/") + 1),
    status,
  };
}

function gitStatus(rootPath: string, changes: GitChangedFile[]): GitStatus {
  return { branch: "main", changes, isRepository: true, rootPath };
}

function Probe(props: UseCheckoutFileStatusesOptions) {
  box.current = useCheckoutFileStatuses(props);
  return null;
}

async function render(props: UseCheckoutFileStatusesOptions): Promise<void> {
  ui = ui ?? mountUi();
  const mounted = ui;
  await act(async () => mounted.render(<Probe {...props} />));
}

describe("checkoutFileStatuses", () => {
  it("keeps the first status per path", () => {
    expect(
      checkoutFileStatuses(
        gitStatus("/wt", [change("/wt/a.ts", "added"), change("/wt/a.ts", "modified")]),
      ),
    ).toEqual({ "/wt/a.ts": "added" });
  });
});

describe("useCheckoutFileStatuses", () => {
  it("drops a late result that belongs to the previous checkout", async () => {
    let resolveFirst: (status: GitStatus) => void = () => undefined;
    const git = {
      getStatus: (root: string) =>
        root === "/wt-a"
          ? new Promise<GitStatus>((resolve) => {
              resolveFirst = resolve;
            })
          : Promise.resolve(gitStatus(root, [change(`${root}/b.ts`, "modified")])),
    };
    await render({ git, root: "/wt-a", revision: 0 });
    await render({ git, root: "/wt-b", revision: 0 });
    await act(async () => resolveFirst(gitStatus("/wt-a", [change("/wt-a/a.ts", "added")])));

    expect(box.current).toEqual({ "/wt-b/b.ts": "modified" });
  });

  it("returns nothing without a checkout", async () => {
    await render({ git: null, root: null, revision: 0 });
    expect(box.current).toBeNull();
  });
});
