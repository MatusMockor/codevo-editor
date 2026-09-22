// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useProjectRepositorySearch } from "../../application/useProjectRepositorySearch";
import type { RepositoryLookupGateway } from "../../application/repositoryLookupPorts";
import type {
  RepositoryHostsSnapshot,
  RepositoryInfo,
  RepositorySearchRequest,
  RepositorySearchOutcome,
} from "../../domain/repositoryLookup";
import {
  ProjectRepositoryPicker,
  type ProjectRepositoryPickerProps,
} from "./ProjectRepositoryPicker";
const hosts: RepositoryHostsSnapshot = {
  github: {
    status: "ready",
    hosts: [{ provider: "github", host: "github.com", auth: "authenticated" }],
    truncated: false,
  },
  gitlab: { status: "cliMissing" },
};
const repository = (fullPath: string): RepositoryInfo => ({
  provider: "github",
  host: "github.com",
  fullPath,
  description: "Project description",
  visibility: "private",
  defaultBranch: "main",
  sshUrl: null,
  httpsUrl: `https://github.com/${fullPath}.git`,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let root: Root;
let host: HTMLDivElement;
let props: ProjectRepositoryPickerProps;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  props = {
    gateway: {
      listHosts: vi.fn(async () => hosts),
      lookup: vi.fn(async () => ({ status: "notFound" as const })),
      search: vi.fn(async () => ({
        status: "ok" as const,
        repositories: [repository("team/crm")],
        nextPage: null,
        truncated: false,
      })),
    },
    environmentLabel: "This computer",
    onChoose: vi.fn(),
    onBack: vi.fn(),
    onUseUrl: vi.fn(),
  };
});
afterEach(() => {
  vi.useRealTimers();
  act(() => root.unmount());
  host.remove();
});
async function render() {
  await act(async () => root.render(<ProjectRepositoryPicker {...props} />));
}
async function click(label: string) {
  const button = [...host.querySelectorAll("button")].find(
    (item) => item.textContent === label || item.getAttribute("aria-label") === label,
  );
  expect(button, label).toBeTruthy();
  await act(async () => button!.click());
}
async function submit() {
  await act(async () =>
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}
function query(value: string) {
  const input = host.querySelector("input")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function start() {
  props = { ...props, initialProvider: "github" };
  await render();
  query("crm");
  await submit();
}
it("searches the chosen machine account and selects a repository", async () => {
  await start();
  expect(props.gateway!.search).toHaveBeenCalledWith({
    provider: "github",
    host: "github.com",
    query: "crm",
    page: 1,
  });
  await click("team/crmProject descriptionprivate");
  expect(props.onChoose).toHaveBeenCalledWith(repository("team/crm"));
});
it("explains setup on the selected machine and offers Git URL", async () => {
  await render();
  await click("GitLabSetup required");
  expect(host.textContent).toContain("Install glab on This computer");
  expect(host.textContent).toContain("glab auth login");
  await click("Use Git URL");
  expect(props.onUseUrl).toHaveBeenCalledOnce();
});
it("rejects stale results after editing search while a request is pending", async () => {
  const pending = deferred<Awaited<ReturnType<NonNullable<RepositoryLookupGateway["search"]>>>>();
  props.gateway!.search = vi.fn(() => pending.promise);
  await start();
  query("new");
  await act(async () =>
    pending.resolve({
      status: "ok",
      repositories: [repository("team/stale")],
      nextPage: null,
      truncated: false,
    }),
  );
  expect(host.textContent).not.toContain("team/stale");
  expect(host.querySelector("input")!.value).toBe("new");
});
it("rejects A to B to A results even when the same gateway returns", async () => {
  const pending = deferred<Awaited<ReturnType<NonNullable<RepositoryLookupGateway["search"]>>>>();
  const original = props.gateway!;
  original.search = vi.fn(() => pending.promise);
  await start();
  props = {
    ...props,
    environmentLabel: "Server",
    gateway: { ...original, listHosts: async () => hosts },
  };
  await render();
  props = { ...props, environmentLabel: "This computer", gateway: original };
  await render();
  await act(async () =>
    pending.resolve({
      status: "ok",
      repositories: [repository("team/stale")],
      nextPage: null,
      truncated: false,
    }),
  );
  expect(host.textContent).not.toContain("team/stale");
});
it("drops pending results when navigating back to provider sources", async () => {
  const pending = deferred<Awaited<ReturnType<NonNullable<RepositoryLookupGateway["search"]>>>>();
  props.gateway!.search = vi.fn(() => pending.promise);
  await render();
  await click("GitHubConnected");
  query("crm");
  await submit();
  await click("Back");
  await act(async () =>
    pending.resolve({
      status: "ok",
      repositories: [repository("team/stale")],
      nextPage: null,
      truncated: false,
    }),
  );
  expect(host.textContent).not.toContain("team/stale");
  expect(host.textContent).toContain("Clone repository");
});
it("falls back to exact lookup without claiming partial-name search", async () => {
  delete props.gateway!.search;
  props.gateway!.lookup = vi.fn(async () => ({
    status: "ok" as const,
    repository: repository("team/crm"),
  }));
  await start();
  expect(props.gateway!.lookup).not.toHaveBeenCalled();
  expect(host.textContent).toContain("full owner/repository path");
  query("team/crm");
  await submit();
  expect(props.gateway!.lookup).toHaveBeenCalledWith({
    provider: "github",
    host: "github.com",
    path: "team/crm",
  });
});
it("bounds results, rejects foreign host rows and reports truncation", async () => {
  props.gateway!.search = vi.fn(async () => ({
    status: "ok" as const,
    repositories: [
      { ...repository("foreign/repo"), host: "evil.example" },
      ...Array.from({ length: 40 }, (_, i) => repository(`team/repo${i}`)),
    ],
    nextPage: 2,
    truncated: false,
  }));
  await start();
  expect(host.querySelectorAll(".project-repository-picker__result")).toHaveLength(19);
  expect(host.textContent).not.toContain("foreign/repo");
  expect(host.textContent).toContain("Some results are not shown");
});
it("uses exact lookup for a full path even when broad search is supported", async () => {
  await start();
  query("team/crm");
  await submit();
  expect(props.gateway!.lookup).toHaveBeenCalledWith({
    provider: "github",
    host: "github.com",
    path: "team/crm",
  });
  expect(props.gateway!.search).toHaveBeenCalledTimes(1);
});
it("keeps provider selection unavailable until account discovery settles", async () => {
  const pending = deferred<RepositoryHostsSnapshot>();
  props.gateway!.listHosts = vi.fn(() => pending.promise);
  await render();
  const providerButton = [...host.querySelectorAll("button")].find(
    (item) => item.textContent === "GitHubChecking…",
  )!;
  expect(providerButton.disabled).toBe(true);
  await act(async () => pending.resolve(hosts));
  await click("GitHubConnected");
  expect(host.querySelector("input")).not.toBeNull();
});
it("caps retained pages at 200 and tells users to narrow results", async () => {
  props.gateway!.search = vi.fn(async ({ page }: RepositorySearchRequest) => ({
    status: "ok" as const,
    repositories: Array.from({ length: 20 }, (_, i) => repository(`team/repo${page}-${i}`)),
    nextPage: page + 1,
    truncated: false,
  }));
  await start();
  for (let page = 2; page <= 10; page += 1) await click("Load more");
  expect(host.querySelectorAll(".project-repository-picker__result")).toHaveLength(200);
  expect(host.textContent).not.toContain("Load more");
  expect(host.textContent).toContain("Narrow your search");
});
it("invalid query never reaches a gateway and explains the input restriction", async () => {
  await start();
  query("crm OR secret:*");
  await submit();
  expect(props.gateway!.search).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("Enter a repository name using");
});

it("accepts exact repository paths longer than the partial-search limit", async () => {
  await start();
  const longPath = `team/${"r".repeat(110)}`;
  query(longPath);
  await submit();
  expect(props.gateway!.lookup).toHaveBeenCalledWith({
    provider: "github",
    host: "github.com",
    path: longPath,
  });
  expect(host.querySelector("input")!.maxLength).toBe(255);
});

it("focuses the shared picker and keeps keyboard navigation within it", async () => {
  await render();
  const section = host.querySelector<HTMLElement>('section[aria-label="Choose repository"]')!;
  expect(document.activeElement).toBe(section);
  const controls = [...section.querySelectorAll<HTMLButtonElement>("button")].filter(
    (button) => !button.disabled,
  );
  const last = controls[controls.length - 1];
  act(() => {
    last.focus();
    last.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }),
    );
  });
  expect(document.activeElement).toBe(controls[0]);
});

it("searches once after a typing pause without a Search button and clears short queries", async () => {
  vi.useFakeTimers();
  props = { ...props, initialProvider: "github" };
  await render();
  expect(
    [...host.querySelectorAll("button")].some((button) => button.textContent === "Search"),
  ).toBe(false);
  query("c");
  await act(async () => vi.advanceTimersByTimeAsync(400));
  expect(props.gateway!.search).not.toHaveBeenCalled();
  query("cr");
  await act(async () => vi.advanceTimersByTimeAsync(200));
  query("crm");
  await act(async () => vi.advanceTimersByTimeAsync(299));
  expect(props.gateway!.search).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(props.gateway!.search).toHaveBeenCalledExactlyOnceWith({
    provider: "github",
    host: "github.com",
    query: "crm",
    page: 1,
  });
  expect(host.textContent).toContain("team/crm");
  query("");
  expect(host.textContent).not.toContain("team/crm");
  await act(async () => vi.advanceTimersByTimeAsync(500));
  expect(props.gateway!.search).toHaveBeenCalledTimes(1);
});

it("Enter searches immediately and cancels the pending automatic search", async () => {
  vi.useFakeTimers();
  props = { ...props, initialProvider: "github" };
  await render();
  query("crm");
  await submit();
  expect(props.gateway!.search).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(600));
  expect(props.gateway!.search).toHaveBeenCalledTimes(1);
});

it("rejects a late response during the next debounce and cancels pending searches on Back", async () => {
  vi.useFakeTimers();
  const pending = deferred<RepositorySearchOutcome>();
  props.gateway!.search = vi.fn(() => pending.promise);
  await render();
  await click("GitHubConnected");
  query("old");
  await act(async () => vi.advanceTimersByTimeAsync(300));
  query("new");
  await act(async () =>
    pending.resolve({
      status: "ok",
      repositories: [repository("team/old")],
      nextPage: null,
      truncated: false,
    }),
  );
  expect(host.textContent).not.toContain("team/old");
  await click("Back");
  await act(async () => vi.advanceTimersByTimeAsync(600));
  expect(props.gateway!.search).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("Clone repository");
});

it("stale owner and unmounted submit callbacks cannot dispatch or cancel the current debounce", async () => {
  vi.useFakeTimers();
  const first = props.gateway!;
  const second = {
    ...first,
    search: vi.fn(async () => ({
      status: "ok" as const,
      repositories: [],
      nextPage: null,
      truncated: false,
    })),
  };
  let model!: ReturnType<typeof useProjectRepositorySearch>;
  function Harness({ gateway }: { gateway: RepositoryLookupGateway }) {
    model = useProjectRepositorySearch(gateway, "machine", "github");
    return null;
  }
  await act(async () => root.render(<Harness gateway={first} />));
  act(() => model.editQuery("old"));
  const oldSubmit = model.submit;
  await act(async () => root.render(<Harness gateway={second} />));
  act(() => model.editQuery("current"));
  await act(async () => oldSubmit());
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(first.search).not.toHaveBeenCalled();
  expect(second.search).toHaveBeenCalledExactlyOnceWith({
    provider: "github",
    host: "github.com",
    query: "current",
    page: 1,
  });
  const unmountedSubmit = model.submit;
  await act(async () => root.render(null));
  await act(async () => unmountedSubmit());
  expect(second.search).toHaveBeenCalledTimes(1);
});

it("hides the redundant host row for a single account host", async () => {
  await start();
  expect(host.textContent).not.toContain("Repository host");
  expect(host.querySelector("select")).toBeNull();
  expect(host.textContent).toContain("This computer");
});

it("uses a themed host listbox for multiple hosts and clears a query when switching", async () => {
  props.gateway!.listHosts = vi.fn(async () => ({
    ...hosts,
    github: {
      status: "ready" as const,
      truncated: false,
      hosts: [
        { provider: "github" as const, host: "github.com", auth: "authenticated" as const },
        {
          provider: "github" as const,
          host: "github.company.test",
          auth: "authenticated" as const,
        },
      ],
    },
  }));
  await start();
  expect(host.querySelector("select")).toBeNull();
  const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="Repository host"]')!;
  act(() => trigger.click());
  act(() =>
    host.querySelector<HTMLElement>('[role="option"][data-value="github.company.test"]')!.click(),
  );
  expect(host.querySelector("input")!.value).toBe("");
  query("crm");
  await submit();
  expect(props.gateway!.search).toHaveBeenLastCalledWith({
    provider: "github",
    host: "github.company.test",
    query: "crm",
    page: 1,
  });
});
