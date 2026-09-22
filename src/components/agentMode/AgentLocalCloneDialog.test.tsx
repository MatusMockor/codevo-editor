// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DirectoryListingGateway } from "../../domain/directoryListing";
import { AgentLocalCloneDialog } from "./AgentLocalCloneDialog";
vi.mock("./AgentAddProjectDialog", () => ({
  AgentAddProjectDialog: ({ onAdd, mode }: { onAdd(path: string): void; mode: string }) => (
    <button onClick={() => onAdd("/projects")}>Pick {mode}</button>
  ),
}));
let root: Root;
let host: HTMLDivElement;
const onClone = vi.fn();
const gateway = {} as DirectoryListingGateway;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  onClone.mockClear();
  act(() =>
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
  const button = [...host.querySelectorAll("button")].find((item) => item.textContent === text)!;
  act(() => button.click());
}
it("requires a chosen destination, defaults the folder from URL and retains fields across picking", () => {
  change(0, "https://github.com/team/repo.git");
  expect(host.querySelectorAll("input")[1].value).toBe("repo");
  expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  click("Choose folder");
  click("Pick selectDirectory");
  expect(host.querySelectorAll("input")[0].value).toBe("https://github.com/team/repo.git");
  click("Clone repository");
  expect(onClone).toHaveBeenCalledWith({
    url: "https://github.com/team/repo.git",
    name: "repo",
    parentPath: "/projects",
  });
});
it("preserves an edited name and rejects unsafe branch even with direct form submission", () => {
  change(0, "https://github.com/team/repo.git");
  change(1, "custom");
  change(0, "https://github.com/team/other.git");
  expect(host.querySelectorAll("input")[1].value).toBe("custom");
  click("Choose folder");
  click("Pick selectDirectory");
  change(2, "--upload-pack=evil");
  act(() =>
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(onClone).not.toHaveBeenCalled();
});

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
  expect(host.querySelectorAll("input")[0].value).toBe(repository.sshUrl);
  expect(host.querySelectorAll("input")[1].value).toBe("crm");
  click("Choose folder");
  click("Pick selectDirectory");
  click("Clone repository");
  expect(onClone).toHaveBeenCalledWith({
    url: repository.sshUrl,
    name: "crm",
    branch: "develop",
    parentPath: "/projects",
  });
});
