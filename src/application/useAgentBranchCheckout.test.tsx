// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAgentBranchCheckout } from "./useAgentBranchCheckout";

type Props = Parameters<typeof useAgentBranchCheckout>[0];
let root: Root;
let props: { -readonly [Key in keyof Props]: Props[Key] };
let result: ReturnType<typeof useAgentBranchCheckout>;
function Harness({ value }: { value: Props }) {
  result = useAgentBranchCheckout(value);
  return null;
}
async function render(value = props) {
  await act(async () => root.render(<Harness value={value} />));
}
const feature = { kind: "branch", ref: "refs/heads/feature" } as const;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  root = createRoot(document.createElement("div"));
  props = {
    target: { rootPath: "/a", ownerKey: "a" },
    gateway: {
      switchBranch: vi.fn(async () => undefined),
      checkoutRemoteBranch: vi.fn(async () => []),
    },
    branches: {
      current: "main",
      local: ["main", "feature"],
      remotes: { origin: ["remote-feature"] },
    },
    guard: vi.fn(() => null),
    onSuccess: vi.fn(),
  };
});
afterEach(async () => {
  await act(async () => root.unmount());
});
it("switches the exact local branch and reports success for the captured owner", async () => {
  await render();
  await act(async () => result.checkout(feature));
  expect(props.gateway?.switchBranch).toHaveBeenCalledWith("/a", "feature");
  expect(props.onSuccess).toHaveBeenCalledWith(props.target);
  expect(result.status).toBe("success");
});
it("uses the remote checkout operation with its exact remote name", async () => {
  await render();
  await act(async () =>
    result.checkout({ kind: "branch", ref: "refs/remotes/origin/remote-feature" }),
  );
  expect(props.gateway?.checkoutRemoteBranch).toHaveBeenCalledWith("/a", "origin/remote-feature");
  expect(props.gateway?.switchBranch).not.toHaveBeenCalled();
});
it("ignores history filters, current branches and unknown refs", async () => {
  await render();
  await act(async () => {
    await result.checkout({ kind: "all" });
    await result.checkout({ kind: "head" });
    await result.checkout({ kind: "branch", ref: "refs/heads/main" });
    await result.checkout({ kind: "branch", ref: "refs/heads/deleted" });
  });
  expect(props.gateway?.switchBranch).not.toHaveBeenCalled();
  expect(result.error).toContain("no longer available");
});
it("revalidates the latest dirty/running guard at the mutation boundary", async () => {
  await render();
  const oldAction = result.checkout;
  await render({ ...props, guard: () => "Save your changes first." });
  await act(async () => oldAction(feature));
  expect(props.gateway?.switchBranch).not.toHaveBeenCalled();
  expect(result.error).toBe("Save your changes first.");
});
it("rejects old A to B to A actions and settlements", async () => {
  let finish!: () => void;
  props.gateway = {
    switchBranch: vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    ),
  };
  await render();
  const oldAction = result.checkout;
  let pending!: Promise<void>;
  await act(async () => {
    pending = oldAction(feature);
  });
  await render({ ...props, target: { rootPath: "/b", ownerKey: "b" } });
  await render();
  await act(async () => {
    finish();
    await pending;
    await oldAction(feature);
  });
  expect(props.gateway.switchBranch).toHaveBeenCalledTimes(1);
  expect(props.onSuccess).not.toHaveBeenCalled();
  expect(result.status).toBe("idle");
});
it("prevents duplicate requests and keeps Git failure truthful", async () => {
  let reject!: (error: Error) => void;
  props.gateway = {
    switchBranch: vi.fn(
      () =>
        new Promise<void>((_, fail) => {
          reject = fail;
        }),
    ),
  };
  await render();
  let pending!: Promise<void>;
  await act(async () => {
    pending = result.checkout(feature);
    await result.checkout(feature);
  });
  expect(props.gateway.switchBranch).toHaveBeenCalledTimes(1);
  await act(async () => {
    reject(new Error("Branch is checked out in another worktree."));
    await pending;
  });
  expect(result.error).toBe("Branch is checked out in another worktree.");
  expect(props.onSuccess).not.toHaveBeenCalled();
});
it("does not publish after unmount", async () => {
  let finish!: () => void;
  props.gateway = {
    switchBranch: vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    ),
  };
  await render();
  let pending!: Promise<void>;
  await act(async () => {
    pending = result.checkout(feature);
  });
  await act(async () => root.unmount());
  await act(async () => {
    finish();
    await pending;
  });
  expect(props.onSuccess).not.toHaveBeenCalled();
});
