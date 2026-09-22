// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DirectoryListingGateway } from "../../domain/directoryListing";
import { AgentLocalCloneDialog } from "./AgentLocalCloneDialog";
vi.mock("./AgentAddProjectDialog", () => ({
  AgentAddProjectDialog: ({
    onAdd,
    onClose,
    mode,
  }: {
    onAdd(path: string): void;
    onClose(): void;
    mode: string;
  }) => (
    <>
      <button onClick={() => onAdd("/projects")}>Pick {mode}</button>
      <button onClick={onClose}>Cancel folder picker</button>
    </>
  ),
}));
let root: Root;
let host: HTMLDivElement;
const onClone = vi.fn();
const gateway: DirectoryListingGateway = {
  listDirectoryEntries: vi.fn(async () => ({
    path: "/home/developer",
    parent: "/home",
    entries: [],
    truncated: false,
  })),
  revealDirectory: vi.fn(async () => undefined),
};
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  onClone.mockClear();
  await act(async () =>
    root.render(
      <AgentLocalCloneDialog
        gateway={gateway}
        busy={false}
        error={null}
        onClose={() => undefined}
        onClone={onClone}
      />,
    ),
  );
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
function change(index: number, value: string) {
  const field = host.querySelectorAll("input")[index];
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function click(text: string) {
  const button = [...host.querySelectorAll("button")].find(
    (item) => item.textContent === text || item.getAttribute("aria-label") === text,
  )!;
  act(() => button.click());
}
it("keeps keyboard focus inside both the URL and destination steps", () => {
  change(0, "https://github.com/team/repo.git");
  const assertFocusWraps = () => {
    const controls = host.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
    const first = controls[0];
    const last = controls[controls.length - 1];
    act(() => {
      last.focus();
      last.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    });
    expect(document.activeElement).toBe(first);
    act(() =>
      first.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }),
      ),
    );
    expect(document.activeElement).toBe(last);
  };
  assertFocusWraps();
  click("Continue");
  assertFocusWraps();
});
it("stages URL before an editable full destination, retaining the inferred name while browsing", () => {
  expect(host.querySelectorAll("input")).toHaveLength(1);
  expect(host.textContent).not.toContain("Destination path");
  change(0, "https://github.com/team/repo.git");
  click("Continue");
  expect(host.querySelector("input")?.value).toBe("/home/developer/repo");
  expect(host.querySelector("details")).toBeNull();
  expect(host.querySelectorAll('[aria-label="Back"]')).toHaveLength(1);
  click("Choose folder");
  click("Pick selectDirectory");
  expect(host.querySelector("input")?.value).toBe("/projects/repo");
  click("Clone repository");
  expect(onClone).toHaveBeenCalledWith({
    url: "https://github.com/team/repo.git",
    name: "repo",
    parentPath: "/projects",
  });
});
it("preserves a custom full path across Back and rejects unsafe destination names", () => {
  change(0, "https://github.com/team/repo.git");
  click("Continue");
  change(0, "/projects/custom");
  click("Back");
  change(0, "https://github.com/team/other.git");
  click("Continue");
  expect(host.querySelector("input")?.value).toBe("/projects/custom");
  change(0, "/projects/..");
  act(() =>
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("absolute destination path");
  expect(onClone).not.toHaveBeenCalled();
});
it("returns from a cancelled folder picker without losing the destination", () => {
  change(0, "https://github.com/team/repo.git");
  click("Continue");
  change(0, "/projects/custom");
  click("Choose folder");
  click("Cancel folder picker");
  expect(host.querySelector("input")?.value).toBe("/projects/custom");
});
it("rejects an invalid Git URL even through direct form submission", () => {
  change(0, "file:///tmp/private");
  act(() =>
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(host.textContent).not.toContain("Destination path");
  expect(onClone).not.toHaveBeenCalled();
});
it("does not navigate or dispatch while starting", () => {
  const onClose = vi.fn();
  act(() =>
    root.render(
      <AgentLocalCloneDialog
        gateway={gateway}
        busy
        error={null}
        onClose={onClose}
        onClone={onClone}
      />,
    ),
  );
  click("Back");
  act(() =>
    host
      .querySelector("section")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  expect(onClose).not.toHaveBeenCalled();
  expect(host.querySelector<HTMLInputElement>("input")?.disabled).toBe(true);
});
it("does not overwrite a typed destination when the default home directory arrives late", async () => {
  let resolve!: (
    value: Awaited<ReturnType<DirectoryListingGateway["listDirectoryEntries"]>>,
  ) => void;
  const delayed: DirectoryListingGateway = {
    ...gateway,
    listDirectoryEntries: () =>
      new Promise((settle) => {
        resolve = settle;
      }),
  };
  await act(async () =>
    root.render(
      <AgentLocalCloneDialog
        key="late"
        gateway={delayed}
        busy={false}
        error={null}
        onClose={() => undefined}
        onClone={onClone}
      />,
    ),
  );
  change(0, "https://github.com/team/repo.git");
  click("Continue");
  change(0, "/chosen/custom");
  await act(async () =>
    resolve({ path: "/home/late", parent: "/home", entries: [], truncated: false }),
  );
  expect(host.querySelector("input")?.value).toBe("/chosen/custom");
  click("Clone repository");
  expect(onClone).toHaveBeenCalledWith({
    url: "https://github.com/team/repo.git",
    name: "custom",
    parentPath: "/chosen",
  });
});
it.each(["relative/repo", "/", "/projects/--unsafe", "/projects/"])(
  "rejects malformed destination %s",
  (path) => {
    change(0, "https://github.com/team/repo.git");
    click("Continue");
    change(0, path);
    act(() =>
      host
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(onClone).not.toHaveBeenCalled();
  },
);

it("searches the local provider account and carries the selected repository into clone confirmation", async () => {
  const repository = {
    provider: "github",
    host: "github.com",
    fullPath: "team/crm",
    description: null,
    visibility: "private",
    defaultBranch: "develop",
    sshUrl: "git@github.com:team/crm.git",
    httpsUrl: "https://github.com/team/crm.git",
  } as const;
  const search = vi.fn(
    async () =>
      ({ status: "ok", repositories: [repository], nextPage: null, truncated: false }) as const,
  );
  const lookupGateway = {
    listHosts: vi.fn(
      async () =>
        ({
          github: {
            status: "ready",
            hosts: [{ provider: "github", host: "github.com", auth: "authenticated" }],
            truncated: false,
          },
          gitlab: { status: "cliMissing" },
        }) as const,
    ),
    lookup: vi.fn(async () => ({ status: "ok", repository }) as const),
    search,
  };
  await act(async () =>
    root.render(
      <AgentLocalCloneDialog
        gateway={gateway}
        lookupGateway={lookupGateway}
        busy={false}
        error={null}
        onClose={() => undefined}
        onClone={onClone}
      />,
    ),
  );
  // The same dialog can also enter the provider picker after having been on its URL step.
  click("Back");
  await act(async () => undefined);
  const provider = [...host.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("GitHub"),
  )!;
  act(() => provider.click());
  change(0, "crm");
  await act(async () =>
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(search).toHaveBeenCalledWith({
    provider: "github",
    host: "github.com",
    query: "crm",
    page: 1,
  });
  const result = [...host.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("team/crm"),
  )!;
  act(() => result.click());
  expect(host.textContent).toContain(repository.sshUrl);
  expect(host.querySelector("input")?.value).toBe("/home/developer/crm");
  expect(host.querySelector("details")).toBeNull();
  click("Choose folder");
  click("Pick selectDirectory");
  click("Clone repository");
  expect(onClone).toHaveBeenCalledWith({
    url: repository.sshUrl,
    name: "crm",
    parentPath: "/projects",
  });
  onClone.mockClear();
  click("Back");
  const gitUrl = [...host.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Git URL"),
  )!;
  act(() => gitUrl.click());
  change(0, "https://github.com/team/other.git");
  click("Continue");
  change(0, "/projects/other");
  click("Clone repository");
  expect(onClone).toHaveBeenCalledExactlyOnceWith({
    url: "https://github.com/team/other.git",
    name: "other",
    parentPath: "/projects",
  });
});
