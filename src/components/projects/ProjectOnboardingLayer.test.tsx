// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RepositoryLookupGateway } from "../../application/repositoryLookupPorts";
import type { DirectoryListingGateway } from "../../domain/directoryListing";
import type { WorkspaceHomeReference } from "../../domain/workspaceRootEligibility";
import type { AgentWorkbenchAddProjectChrome } from "../agentMode/agentWorkbenchChrome";
import { fakeRemoteAddProjectController } from "../agentMode/remoteAddProject/remoteAddProjectTestSupport";
import { ProjectOnboardingLayer, type ProjectOnboardingCreation } from "./ProjectOnboardingLayer";

function directoryGateway(): DirectoryListingGateway {
  return {
    listDirectoryEntries: vi.fn(async ({ path }) => ({
      path: path ?? "/Users/dev",
      parent: "/",
      entries: [],
      truncated: false,
    })),
    revealDirectory: vi.fn(async () => undefined),
  };
}

const HOME: WorkspaceHomeReference = { path: "/Users/dev", pathCase: "insensitive" };
const resolveHome = vi.fn(async () => HOME);

function lookupFixture(): RepositoryLookupGateway {
  return {
    listHosts: vi.fn(async () => ({
      github: {
        status: "ready" as const,
        hosts: [
          { provider: "github" as const, host: "github.com", auth: "authenticated" as const },
        ],
        truncated: false,
      },
      gitlab: { status: "cliMissing" as const },
    })),
    lookup: vi.fn(async () => ({ status: "notFound" as const })),
    search: vi.fn(async () => ({
      status: "ok" as const,
      repositories: [],
      nextPage: null,
      truncated: false,
    })),
  };
}

function creationFixture(
  overrides: Partial<ProjectOnboardingCreation> = {},
): ProjectOnboardingCreation {
  return {
    entryOpen: true,
    open: vi.fn(),
    closeEntry: vi.fn(),
    choose: vi.fn(),
    capacityError: null,
    pendingClones: [],
    localDialogOpen: false,
    closeLocal: vi.fn(),
    local: {
      start: vi.fn(),
      busy: false,
      error: null,
    } as unknown as ProjectOnboardingCreation["local"],
    existingServerProjects: null,
    closeExisting: vi.fn(),
    selectExisting: vi.fn(),
    remoteAdd: fakeRemoteAddProjectController({
      open: false,
    }) as unknown as ProjectOnboardingCreation["remoteAdd"],
    addProject: {
      open: false,
      projectRootPaths: [],
      openDialog: vi.fn(),
      closeDialog: vi.fn(),
      addProject: vi.fn(),
      reportNotice: vi.fn(),
    },
    ...overrides,
  };
}

function chromeFixture(): AgentWorkbenchAddProjectChrome {
  return {
    gateway: directoryGateway(),
    cloneGateway: { start: vi.fn(), get: vi.fn(), cancel: vi.fn() },
    cloneDestination: { lastParentPath: null, remember: vi.fn() },
    recentFolders: [
      { path: "/Users/dev/code/billing-worker", label: "billing-worker", openedAtMs: null },
    ],
    addProject: vi.fn(),
  };
}

describe("ProjectOnboardingLayer", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  function option(text: string): HTMLElement {
    const found = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(
      (item) => item.textContent?.includes(text),
    );
    expect(found).toBeInstanceOf(HTMLElement);
    return found as HTMLElement;
  }
  async function render(
    creation: ProjectOnboardingCreation,
    chrome: AgentWorkbenchAddProjectChrome | null = chromeFixture(),
    lookupGateway: RepositoryLookupGateway | null = null,
  ) {
    await act(async () =>
      root.render(
        <ProjectOnboardingLayer
          chrome={chrome}
          creation={creation}
          lookupGateway={lookupGateway}
          resolveHome={resolveHome}
          selectedServerId={null}
          servers={[]}
        />,
      ),
    );
  }

  it("routes sources to the existing creation flows", async () => {
    const creation = creationFixture();
    await render(creation);
    act(() => option("Open folder").click());
    expect(creation.choose).toHaveBeenCalledWith(null, "existing");
    act(() => option("Git URL").click());
    expect(creation.choose).toHaveBeenCalledWith(null, "clone");
    act(() => option("billing-worker").click());
    expect(creation.closeEntry).toHaveBeenCalled();
    expect(creation.addProject.addProject).toHaveBeenCalledWith("/Users/dev/code/billing-worker");
  });

  it("renders the clone form for the reserved lane and remembers the parent only once the clone completes", async () => {
    const chrome = chromeFixture();
    const creation = creationFixture({ entryOpen: false, localDialogOpen: true });
    await render(creation, chrome);
    const input = document.querySelector<HTMLInputElement>(
      'input[placeholder="Enter Git clone URL or owner/repo"]',
    );
    expect(input).toBeInstanceOf(HTMLInputElement);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setter?.call(input, "https://github.com/acme/web-dashboard");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 260));
    });
    act(() => document.querySelector<HTMLButtonElement>('button[type="submit"]')?.click());
    expect(chrome.cloneDestination?.remember).not.toHaveBeenCalled();
    expect(creation.local.start).toHaveBeenCalledWith({
      url: "https://github.com/acme/web-dashboard",
      name: "web-dashboard",
      parentPath: "/Users/dev/code",
      ensureParent: true,
    });
    const back = document.querySelector<HTMLButtonElement>('button[aria-label="Back"]');
    act(() => back?.click());
    expect(creation.closeLocal).toHaveBeenCalled();
    expect(creation.open).toHaveBeenCalled();
  });

  it("seeds the clone form with a URL pasted into the Add project page", async () => {
    const creation = creationFixture();
    await render(creation);
    const input = document.querySelector<HTMLInputElement>(
      'input[placeholder="Search sources, or paste a path or Git URL"]',
    );
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setter?.call(input, "https://github.com/acme/web-dashboard");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(creation.choose).toHaveBeenCalledWith(null, "clone");
    await render({ ...creation, entryOpen: false, localDialogOpen: true });
    const url = document.querySelector<HTMLInputElement>(
      'input[placeholder="Enter Git clone URL or owner/repo"]',
    );
    expect(url?.value).toBe("https://github.com/acme/web-dashboard");
  });

  it("opens an existing project from the clone form through the add-project flow", async () => {
    const creation = creationFixture({
      entryOpen: false,
      localDialogOpen: true,
      addProject: {
        ...creationFixture().addProject,
        projectRootPaths: ["/Users/dev/code/web-dashboard"],
      },
    });
    await render(creation);
    const input = document.querySelector<HTMLInputElement>(
      'input[placeholder="Enter Git clone URL or owner/repo"]',
    );
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setter?.call(input, "https://github.com/acme/web-dashboard");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const open = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Open existing",
    );
    act(() => open?.click());
    expect(creation.closeLocal).toHaveBeenCalled();
    expect(creation.addProject.addProject).toHaveBeenCalledWith("/Users/dev/code/web-dashboard");
    expect(creation.local.start).not.toHaveBeenCalled();
  });

  it("shows the capacity notice and blocks clone sources at four pending clones", async () => {
    const creation = creationFixture({
      pendingClones: Array.from({ length: 4 }, (_, index) => ({
        id: `${index}:c`,
        name: `c${index}`,
        environment: "local",
        status: "running",
        error: null,
      })) as unknown as ProjectOnboardingCreation["pendingClones"],
    });
    await render(creation);
    expect(document.body.textContent).toContain(
      "You can keep up to 4 clones open. Finish or remove one before starting another.",
    );
    expect(option("Git URL").getAttribute("aria-disabled")).toBe("true");
  });

  it("disables clone sources when this computer cannot clone", async () => {
    const creation = creationFixture();
    await render(creation, { ...chromeFixture(), cloneGateway: null });
    expect(option("Git URL").getAttribute("aria-disabled")).toBe("true");
    expect(option("Git URL").getAttribute("title")).toBe(
      "Cloning is not available on this computer.",
    );
  });

  it("lists the server projects dialog when a server is chosen", async () => {
    const creation = creationFixture({
      entryOpen: false,
      existingServerProjects: [{ key: "srv:/srv/app", label: "app" }],
    });
    await render(creation);
    const row = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "app",
    );
    act(() => row?.click());
    expect(creation.selectExisting).toHaveBeenCalledWith("srv:/srv/app");
  });

  it("hosts the repository picker in a modal dialog that closes with Escape and restores focus", async () => {
    const invoker = document.createElement("button");
    invoker.textContent = "Add project";
    document.body.append(invoker);
    invoker.focus();
    const creation = creationFixture();
    const lookup = lookupFixture();
    await render(creation, chromeFixture(), lookup);
    act(() => option("GitHub repository").click());
    expect(creation.closeEntry).toHaveBeenCalled();
    await render({ ...creation, entryOpen: false }, chromeFixture(), lookup);
    const dialog = document.querySelector<HTMLElement>(
      '[role="dialog"][aria-label="Choose repository"]',
    );
    expect(dialog).toBeInstanceOf(HTMLElement);
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    act(() => {
      (document.activeElement ?? dialog)?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    expect(document.querySelector('[aria-label="Choose repository"]')).toBeNull();
    expect(document.activeElement).toBe(invoker);
    invoker.remove();
  });

  it("remembers the clone parent when the started clone succeeds but not when it fails", async () => {
    const chrome = chromeFixture();
    const other = {
      id: "1:old",
      name: "web-dashboard",
      environment: "local",
      status: "succeeded",
      error: null,
    };
    const creation = creationFixture({
      entryOpen: false,
      localDialogOpen: true,
      pendingClones: [other] as unknown as ProjectOnboardingCreation["pendingClones"],
    });
    await render(creation, chrome);
    const input = document.querySelector<HTMLInputElement>(
      'input[placeholder="Enter Git clone URL or owner/repo"]',
    );
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setter?.call(input, "https://github.com/acme/web-dashboard");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 260));
    });
    act(() => document.querySelector<HTMLButtonElement>('button[type="submit"]')?.click());
    const clone = (status: string) =>
      [
        other,
        { id: "0:c1", name: "web-dashboard", environment: "local", status, error: null },
      ] as unknown as ProjectOnboardingCreation["pendingClones"];
    await render({ ...creation, localDialogOpen: false, pendingClones: clone("running") }, chrome);
    expect(chrome.cloneDestination?.remember).not.toHaveBeenCalled();
    await render(
      { ...creation, localDialogOpen: false, pendingClones: clone("succeeded") },
      chrome,
    );
    expect(chrome.cloneDestination?.remember).toHaveBeenCalledExactlyOnceWith("/Users/dev/code");
  });

  it("forgets the staged clone parent when the clone fails", async () => {
    const chrome = chromeFixture();
    const creation = creationFixture({ entryOpen: false, localDialogOpen: true });
    await render(creation, chrome);
    const input = document.querySelector<HTMLInputElement>(
      'input[placeholder="Enter Git clone URL or owner/repo"]',
    );
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setter?.call(input, "https://github.com/acme/web-dashboard");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 260));
    });
    act(() => document.querySelector<HTMLButtonElement>('button[type="submit"]')?.click());
    const clone = (id: string, status: string) =>
      [
        { id, name: "web-dashboard", environment: "local", status, error: null },
      ] as unknown as ProjectOnboardingCreation["pendingClones"];
    await render(
      { ...creation, localDialogOpen: false, pendingClones: clone("0:c1", "failed") },
      chrome,
    );
    await render({ ...creation, localDialogOpen: false, pendingClones: [] }, chrome);
    await render(
      { ...creation, localDialogOpen: false, pendingClones: clone("0:c2", "succeeded") },
      chrome,
    );
    expect(chrome.cloneDestination?.remember).not.toHaveBeenCalled();
  });
});
