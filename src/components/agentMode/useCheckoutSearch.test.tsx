// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentPickerOption, type AgentPickerOption } from "./agentPickerOption";
import { useCheckoutSearch } from "./useCheckoutSearch";

function repositoryOptions(prefix: string) {
  return [
    agentPickerOption("in-place", "Local"),
    agentPickerOption(`root:/${prefix}`, "Project"),
    ...Array.from({ length: 500 }, (_, index) =>
      agentPickerOption(`root:/${prefix}/repo-${index}`, `repo-${index}`),
    ),
  ];
}

describe("checkout search ownership", () => {
  let root: Root;
  let host: HTMLDivElement;
  let latest: ReturnType<typeof useCheckoutSearch>;
  beforeEach(() => {
    vi.useFakeTimers();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
  });

  function Harness({
    options,
    open,
    identity,
  }: {
    readonly options: ReadonlyArray<AgentPickerOption>;
    readonly open: boolean;
    readonly identity?: object;
  }) {
    latest = useCheckoutSearch(options, true, open, identity);
    return null;
  }
  function render(options: ReadonlyArray<AgentPickerOption>, open = true, identity?: object) {
    act(() => root.render(<Harness options={options} open={open} identity={identity} />));
  }
  async function settle() {
    await act(async () => vi.runAllTimersAsync());
  }

  it("does not restore completed A query, page or results when the same snapshot returns after B", async () => {
    const a = repositoryOptions("a");
    const b = repositoryOptions("b");
    render(a);
    act(() => latest.setQuery("repo"));
    await settle();
    act(() => latest.setPage(3));
    await settle();
    expect(latest.page).toBe(3);
    expect(latest.visibleOptions[2]?.value).toBe("root:/a/repo-150");
    const oldQuery = latest.setQuery;
    const oldPage = latest.setPage;
    render(b);
    render(a);
    expect(latest.query).toBe("");
    expect(latest.page).toBe(0);
    expect(latest.visibleOptions[2]?.value).toBe("root:/a/repo-0");
    act(() => {
      oldQuery("repo-499");
      oldPage(4);
    });
    await settle();
    expect(latest.query).toBe("");
    expect(latest.page).toBe(0);
    expect(latest.total).toBe(500);
  });

  it("cancels a pending A scan across B and reused A and rejects its old callbacks", async () => {
    const a = repositoryOptions("a");
    render(a);
    const oldPage = latest.setPage;
    act(() => latest.setQuery("repo-499"));
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(latest.busy).toBe(true);
    const oldQuery = latest.setQuery;
    render(repositoryOptions("b"));
    render(a);
    act(() => {
      oldPage(9);
      oldQuery("repo-49");
    });
    await settle();
    expect(latest.query).toBe("");
    expect(latest.page).toBe(0);
    expect(latest.total).toBe(500);
    expect(latest.visibleOptions).toHaveLength(52);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves query and page for an isolation-only change but invalidates old results and controls", async () => {
    const identity = {};
    const local = repositoryOptions("a");
    const worktree = [local[0]!, agentPickerOption("worktree", "Isolated"), ...local.slice(1)];
    render(local, true, identity);
    act(() => latest.setQuery("repo"));
    await settle();
    act(() => latest.setPage(3));
    await settle();
    const oldQuery = latest.setQuery;
    const oldPage = latest.setPage;
    render(worktree, true, identity);
    expect(latest.query).toBe("repo");
    expect(latest.page).toBe(3);
    expect(latest.busy).toBe(true);
    expect(latest.visibleOptions).toHaveLength(3);
    act(() => {
      oldQuery("repo-499");
      oldPage(9);
    });
    await settle();
    expect(latest.query).toBe("repo");
    expect(latest.page).toBe(3);
    expect(latest.visibleOptions[3]?.value).toBe("root:/a/repo-150");
    render(local, true, identity);
    await settle();
    expect(latest.query).toBe("repo");
    expect(latest.page).toBe(3);
    expect(latest.visibleOptions[2]?.value).toBe("root:/a/repo-150");
  });

  it("restarts a pending scan with current options and resets for a new owner with identical contents", async () => {
    const identity = {};
    const local = repositoryOptions("a");
    const worktree = [local[0]!, agentPickerOption("worktree", "Isolated"), ...local.slice(1)];
    render(local, true, identity);
    act(() => latest.setQuery("repo-499"));
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(latest.busy).toBe(true);
    render(worktree, true, identity);
    expect(latest.query).toBe("repo-499");
    await settle();
    expect(latest.total).toBe(1);
    expect(latest.visibleOptions[3]?.value).toBe("root:/a/repo-499");
    const oldQuery = latest.setQuery;
    render(worktree, true, {});
    expect(latest.query).toBe("");
    expect(latest.total).toBe(500);
    render(worktree, true, identity);
    act(() => oldQuery("repo-49"));
    await settle();
    expect(latest.query).toBe("");
    expect(latest.page).toBe(0);
  });

  it("invalidates old controls on close and does not page a superseded query", async () => {
    const a = repositoryOptions("a");
    render(a);
    const oldPage = latest.setPage;
    act(() => latest.setQuery("repo-49"));
    await settle();
    act(() => oldPage(9));
    expect(latest.page).toBe(0);
    expect(latest.total).toBe(11);
    const oldQuery = latest.setQuery;
    render(a, false);
    render(a);
    act(() => oldQuery("repo-499"));
    await settle();
    expect(latest.query).toBe("");
    expect(latest.total).toBe(500);
  });
});
