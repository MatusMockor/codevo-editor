// @vitest-environment jsdom
import { act, useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PROJECT_DISPLAY_NAMES_STORAGE_KEY } from "../../application/projectDisplayNames";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import { groupedEnvironmentProjects } from "./agentEnvironmentProjects";
import { agentProjectGroups } from "./agentModePresentation";
import type {
  AgentProjectMenuCommand,
  AgentProjectMenuTarget,
} from "./agentProjectMenuPresentation";
import { AgentProjectRenameDialog } from "./AgentProjectRenameDialog";
import { AgentProjectSwitcher } from "./AgentProjectSwitcher";
import { agentRailScopeEntries } from "./agentSidebarPresentation";
import { fixtureRepository, projectFixture } from "./agentThreadsSurfaceTestFixtures";
import { useAgentProjectRename } from "./useAgentProjectRename";

const LOCAL = "/Users/dev/editor";
const SERVER = "remote:linux:runner:codevo-editor";
const API = "/Users/dev/api";
const IDENTITY = "github.com/codevo/editor";
const STORAGE_QUOTA_CHARS = 5_000_000;
const TOKEN_A = "aaaaaaaaaaaaaaaa";
const TOKEN_B = "bbbbbbbbbbbbbbbb";
const FIRST_TOKEN = "0000000000000001";
const SECOND_TOKEN = "0000000000000002";

function project(rootKey: string, label: string, identity?: string): AgentProjectDescriptor {
  return projectFixture({
    rootKey,
    rootPath: rootKey,
    ownerId: `owner:${rootKey}`,
    label,
    repositories: [fixtureRepository(rootKey, "")],
    ...(identity === undefined ? {} : { repositoryIdentity: identity }),
  });
}

const MERGED = [
  project(LOCAL, "editor", IDENTITY),
  project(SERVER, "codevo-editor", IDENTITY),
  project(API, "api"),
];

interface Recorded {
  readonly commands: Array<readonly [AgentProjectMenuTarget, AgentProjectMenuCommand]>;
  readonly selected: string[];
}

function Harness({
  generateToken,
  projects,
  recorded,
}: {
  readonly generateToken: () => string;
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly recorded: Recorded;
}) {
  const executionGroups = useMemo(() => agentProjectGroups(projects, [], []), [projects]);
  const groups = useMemo(
    () => groupedEnvironmentProjects(executionGroups, projects, new Map()),
    [executionGroups, projects],
  );
  const rename = useAgentProjectRename({
    groups,
    executionGroups,
    projects,
    catalog: undefined,
    generateToken,
  });
  const entries = agentRailScopeEntries(rename.groups);
  return (
    <>
      <AgentProjectSwitcher
        activeEntry={entries[0] ?? null}
        entries={entries}
        focus="all"
        onProjectCommand={(target, command) => {
          recorded.commands.push([target, command]);
          if (command === "rename") rename.request(target.projectRootKey);
        }}
        onSelectAll={() => undefined}
        onSelectProject={(projectRootKey) => recorded.selected.push(projectRootKey)}
        signals={new Map()}
      />
      <AgentProjectRenameDialog
        onCancel={rename.cancel}
        onSubmit={rename.submit}
        target={rename.target}
      />
    </>
  );
}

describe("rename project dialog", () => {
  let host: HTMLDivElement;
  let root: Root;
  let recorded: Recorded;
  let generatedTokens = 0;
  const generateToken = (): string => {
    generatedTokens += 1;
    return generatedTokens.toString(16).padStart(16, "0");
  };

  beforeEach(() => {
    localStorage.clear();
    generatedTokens = 0;
    recorded = { commands: [], selected: [] };
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render(projects: ReadonlyArray<AgentProjectDescriptor> = MERGED): void {
    act(() =>
      root.render(
        <Harness generateToken={generateToken} projects={projects} recorded={recorded} />,
      ),
    );
  }

  function trigger(): HTMLButtonElement {
    const button = host.querySelector<HTMLButtonElement>(".cv-sb-switch");
    expect(button).not.toBeNull();
    return button as HTMLButtonElement;
  }

  function optionLabels(): ReadonlyArray<string> {
    return [...document.querySelectorAll('[role="option"] .cv-project-switch__label')].map(
      (node) => node.textContent ?? "",
    );
  }

  function typeInto(input: HTMLInputElement | null, value: string): void {
    expect(input).not.toBeNull();
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function searchSwitcher(query: string): ReadonlyArray<string> {
    act(() => trigger().click());
    typeInto(
      document.querySelector<HTMLInputElement>('input[aria-label="Search projects"]'),
      query,
    );
    const labels = optionLabels();
    act(() => trigger().click());
    return labels;
  }

  function openRename(label: string): void {
    act(() => trigger().click());
    const gear = document.querySelector<HTMLButtonElement>(
      `button[aria-label="Project settings for ${label}"]`,
    );
    expect(gear).not.toBeNull();
    act(() => gear?.click());
    const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (candidate) => candidate.textContent === "Rename project…",
    );
    expect(item).toBeDefined();
    act(() => item?.click());
  }

  function dialog(): HTMLElement | null {
    return document.querySelector<HTMLElement>(".cv-dialog");
  }

  function nameInput(): HTMLInputElement {
    const input = dialog()?.querySelector<HTMLInputElement>("input") ?? null;
    expect(input).not.toBeNull();
    return input as HTMLInputElement;
  }

  function dialogButton(label: string): HTMLButtonElement | null {
    return (
      [...(dialog()?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
        (candidate) => candidate.textContent === label,
      ) ?? null
    );
  }

  function press(key: string): void {
    act(() => {
      nameInput().dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key }),
      );
    });
  }

  function storedEntries(): ReadonlyArray<ReadonlyArray<unknown>> | null {
    const raw = localStorage.getItem(PROJECT_DISPLAY_NAMES_STORAGE_KEY);
    if (raw === null) return null;
    return JSON.parse(raw) as ReadonlyArray<ReadonlyArray<unknown>>;
  }

  function storedNames(): unknown {
    return storedEntries()?.map((entry) => entry.slice(0, 2)) ?? null;
  }

  it("opens from the project gear with an accessible, focused, empty field and the default name as placeholder", () => {
    render();

    openRename("editor");

    const surface = dialog();
    expect(surface?.getAttribute("role")).toBe("dialog");
    expect(surface?.getAttribute("aria-modal")).toBe("true");
    expect(surface?.querySelector("h2")?.textContent).toBe("Rename project");
    expect(surface?.textContent).toContain(
      "The name applies to all 2 checkouts of this project in Codevo. Folders and server projects are not renamed.",
    );
    expect(surface?.querySelector("label")?.textContent).toBe("Project name");
    expect(nameInput().value).toBe("");
    expect(nameInput().placeholder).toBe("editor");
    expect(document.activeElement).toBe(nameInput());
    expect(dialogButton("Reset to default")).toBeNull();
    expect(recorded.commands).toEqual([
      [{ projectRootKey: LOCAL, repositoryRoot: LOCAL, rootPath: LOCAL }, "rename"],
    ]);
  });

  it("describes a single checkout without mentioning other checkouts", () => {
    render();

    openRename("api");

    expect(dialog()?.textContent).toContain(
      "The name is shown only in Codevo. The project folder is not renamed.",
    );
    expect(nameInput().placeholder).toBe("api");
  });

  it("renames every checkout with Enter and shows the name in the switcher", () => {
    render();
    openRename("editor");

    typeInto(nameInput(), "  Flagship  ");
    press("Enter");

    expect(dialog()).toBeNull();
    expect(storedNames()).toEqual([
      [LOCAL, "Flagship"],
      [SERVER, "Flagship"],
    ]);
    expect(trigger().getAttribute("aria-label")).toBe("Switch project: Flagship");
    expect(trigger().title).toBe("Flagship");
    expect(trigger().querySelector(".cv-project-badge")?.textContent).toBe("FP");
    expect(document.activeElement).toBe(trigger());
    act(() => trigger().click());
    expect(optionLabels()).toEqual(["All projects", "Flagship", "api"]);
    expect(
      document.querySelector('button[aria-label="Project settings for Flagship"]'),
    ).not.toBeNull();
    expect(document.querySelector('button[aria-label="Close project Flagship"]')).not.toBeNull();
    act(() => trigger().click());
  });

  it("finds a renamed project by its new name in the switcher search", () => {
    render();
    openRename("editor");
    typeInto(nameInput(), "Flagship");
    act(() => dialogButton("Rename")?.click());

    expect(searchSwitcher("flag")).toEqual(["Flagship"]);
    expect(searchSwitcher("api")).toEqual(["api"]);
  });

  it("still finds a renamed project by its original folder name", () => {
    render();
    openRename("editor");
    typeInto(nameInput(), "Flagship");
    press("Enter");

    expect(searchSwitcher("edit")).toEqual(["Flagship"]);
    expect(searchSwitcher("EDITOR")).toEqual(["Flagship"]);
    expect(searchSwitcher("codevo")).toEqual([]);
    act(() => trigger().click());
    typeInto(
      document.querySelector<HTMLInputElement>('input[aria-label="Search projects"]'),
      "edit",
    );
    const found = document.querySelector<HTMLElement>('[role="option"]');
    expect(found?.dataset.value).toBe(LOCAL);
    act(() => found?.click());
    expect(recorded.selected).toEqual([LOCAL]);
  });

  it("keeps selection and command targets on the physical project after a rename", () => {
    render();
    openRename("editor");
    typeInto(nameInput(), "Flagship");
    press("Enter");

    act(() => trigger().click());
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (candidate) => candidate.textContent?.includes("Flagship") === true,
    );
    expect(option?.dataset.value).toBe(LOCAL);
    act(() => option?.click());
    openRename("Flagship");

    expect(recorded.selected).toEqual([LOCAL]);
    expect(recorded.commands.map(([target]) => target)).toEqual([
      { projectRootKey: LOCAL, repositoryRoot: LOCAL, rootPath: LOCAL },
      { projectRootKey: LOCAL, repositoryRoot: LOCAL, rootPath: LOCAL },
    ]);
  });

  it("rejects a name that is too long inline without saving or truncating it", () => {
    render();
    openRename("editor");
    const tooLong = "n".repeat(65);

    typeInto(nameInput(), tooLong);
    press("Enter");

    expect(dialog()?.querySelector('[role="alert"]')?.textContent).toBe(
      "Use 64 characters or fewer.",
    );
    expect(nameInput().getAttribute("aria-invalid")).toBe("true");
    expect(nameInput().value).toBe(tooLong);
    expect(nameInput().maxLength).toBe(4096);
    expect(dialogButton("Rename")?.disabled).toBe(true);
    expect(storedNames()).toBeNull();

    typeInto(nameInput(), "n".repeat(64));
    expect(dialog()?.querySelector('[role="alert"]')).toBeNull();
    expect(dialogButton("Rename")?.disabled).toBe(false);
  });

  it("rejects control characters inline", () => {
    render();
    openRename("editor");

    typeInto(nameInput(), "bell\u0007name");
    press("Enter");

    expect(dialog()?.querySelector('[role="alert"]')?.textContent).toBe(
      "Use a single line without control characters.",
    );
    expect(storedNames()).toBeNull();
    expect(dialog()).not.toBeNull();
  });

  it("cancels with Escape or Cancel without saving", () => {
    render();
    openRename("editor");
    typeInto(nameInput(), "Flagship");

    press("Escape");

    expect(dialog()).toBeNull();
    expect(storedNames()).toBeNull();
    expect(document.activeElement).toBe(trigger());

    openRename("editor");
    expect(nameInput().value).toBe("");
    typeInto(nameInput(), "Flagship");
    act(() => dialogButton("Cancel")?.click());

    expect(dialog()).toBeNull();
    expect(storedNames()).toBeNull();
    expect(trigger().getAttribute("aria-label")).toBe("Switch project: editor");
  });

  it("offers Reset to default for a renamed project and restores every checkout", () => {
    render();
    openRename("editor");
    typeInto(nameInput(), "Flagship");
    press("Enter");

    openRename("Flagship");
    expect(nameInput().value).toBe("Flagship");
    expect(nameInput().placeholder).toBe("editor");
    act(() => dialogButton("Reset to default")?.click());

    expect(dialog()).toBeNull();
    expect(storedNames()).toBeNull();
    expect(trigger().getAttribute("aria-label")).toBe("Switch project: editor");
    expect(searchSwitcher("")).toEqual(["All projects", "editor", "api"]);
  });

  it("resets to the default name when the field is cleared and confirmed", () => {
    render();
    openRename("editor");
    typeInto(nameInput(), "Flagship");
    press("Enter");
    openRename("api");
    typeInto(nameInput(), "Backend");
    press("Enter");

    openRename("Flagship");
    typeInto(nameInput(), "   ");
    press("Enter");

    expect(dialog()).toBeNull();
    expect(storedNames()).toEqual([[API, "Backend"]]);
    expect(searchSwitcher("")).toEqual(["All projects", "editor", "Backend"]);
  });

  it("unifies checkouts that were renamed differently before they were grouped", () => {
    localStorage.setItem(
      PROJECT_DISPLAY_NAMES_STORAGE_KEY,
      JSON.stringify([
        [SERVER, "Server name", TOKEN_B],
        [LOCAL, "Local name", TOKEN_A],
      ]),
    );
    render();

    expect(trigger().getAttribute("aria-label")).toBe("Switch project: Local name");
    openRename("Local name");
    expect(nameInput().value).toBe("Local name");
    typeInto(nameInput(), "One name");
    press("Enter");

    expect(storedEntries()).toEqual([
      [SERVER, "One name", TOKEN_A],
      [LOCAL, "One name", TOKEN_A],
    ]);
  });

  it("shows the reason when the name cannot be stored and keeps the dialog open", () => {
    render();
    openRename("editor");
    localStorage.setItem("filler", "x".repeat(STORAGE_QUOTA_CHARS - "filler".length));

    typeInto(nameInput(), "Flagship");
    press("Enter");

    expect(dialog()?.querySelector('[role="alert"]')?.textContent).toBe(
      "The project name could not be saved.",
    );
    expect(storedNames()).toBeNull();
    expect(trigger().getAttribute("aria-label")).toBe("Switch project: editor");

    typeInto(nameInput(), "Flagship 2");
    expect(dialog()?.querySelector('[role="alert"]')).toBeNull();
  });

  it("closes when the project goes away and stays closed when it returns", () => {
    render();
    openRename("api");
    expect(dialog()).not.toBeNull();

    render(MERGED.slice(0, 2));
    expect(dialog()).toBeNull();

    render();
    expect(dialog()).toBeNull();
    expect(storedNames()).toBeNull();
  });

  it("follows a name written by another window", () => {
    render();

    act(() => {
      localStorage.setItem(
        PROJECT_DISPLAY_NAMES_STORAGE_KEY,
        JSON.stringify([[SERVER, "Remote", TOKEN_A]]),
      );
      window.dispatchEvent(new StorageEvent("storage", { key: PROJECT_DISPLAY_NAMES_STORAGE_KEY }));
    });

    expect(trigger().getAttribute("aria-label")).toBe("Switch project: Remote");
  });

  it("rejects a name without any visible character inline", () => {
    render();
    openRename("editor");

    typeInto(nameInput(), "\u200b\u00ad");
    press("Enter");

    expect(dialog()?.querySelector('[role="alert"]')?.textContent).toBe(
      "Use at least one visible character.",
    );
    expect(dialogButton("Rename")?.disabled).toBe(true);
    expect(storedNames()).toBeNull();

    typeInto(nameInput(), "a\u200db");
    press("Enter");
    expect(storedNames()).toEqual([
      [LOCAL, "a\u200db"],
      [SERVER, "a\u200db"],
    ]);
  });

  it("hints when another project already shows the entered name and still allows it", () => {
    render();
    openRename("editor");

    typeInto(nameInput(), "API");

    const hint = dialog()?.querySelector(".cv-field__hint");
    expect(hint?.textContent).toBe(
      'Another project is already named "api". You can still use this name.',
    );
    expect(hint?.getAttribute("role")).toBeNull();
    expect(nameInput().getAttribute("aria-invalid")).toBe("false");
    expect(nameInput().getAttribute("aria-describedby")).toBe(hint?.id);
    expect(dialogButton("Rename")?.disabled).toBe(false);

    typeInto(nameInput(), "Flagship");
    expect(dialog()?.querySelector(".cv-field__hint")).toBeNull();

    typeInto(nameInput(), "api");
    press("Enter");
    expect(dialog()).toBeNull();
    expect(storedNames()).toEqual([
      [LOCAL, "api"],
      [SERVER, "api"],
    ]);
    expect(searchSwitcher("")).toEqual(["All projects", "api", "api"]);
  });

  it("selects the current name only on the first focus", () => {
    render();
    openRename("editor");
    typeInto(nameInput(), "Flagship");
    press("Enter");

    openRename("Flagship");
    const input = nameInput();
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, "Flagship".length]);

    act(() => {
      input.setSelectionRange(2, 2);
      dialogButton("Cancel")?.focus();
    });
    expect(document.activeElement).toBe(dialogButton("Cancel"));
    act(() => input.focus());

    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([2, 2]);
  });

  it("keeps the typed value when another window changes stored names while the dialog is open", () => {
    render();
    openRename("editor");
    typeInto(nameInput(), "Half typed");

    act(() => {
      localStorage.setItem(
        PROJECT_DISPLAY_NAMES_STORAGE_KEY,
        JSON.stringify([
          [LOCAL, "Theirs", TOKEN_A],
          [API, "Backend", TOKEN_B],
        ]),
      );
      window.dispatchEvent(new StorageEvent("storage", { key: PROJECT_DISPLAY_NAMES_STORAGE_KEY }));
    });

    expect(dialog()).not.toBeNull();
    expect(nameInput().value).toBe("Half typed");
    expect(nameInput().placeholder).toBe("editor");
    expect(dialogButton("Reset to default")).not.toBeNull();
    expect(trigger().getAttribute("aria-label")).toBe("Switch project: Theirs");

    press("Enter");

    expect(storedEntries()).toEqual([
      [LOCAL, "Half typed", TOKEN_A],
      [API, "Backend", TOKEN_B],
      [SERVER, "Half typed", TOKEN_A],
    ]);
  });

  it("keeps the dialog and typed value when the group's representative changes while open", () => {
    render([project(SERVER, "codevo-editor", IDENTITY), project(API, "api")]);
    openRename("codevo-editor");
    typeInto(nameInput(), "Flagship");
    expect(nameInput().placeholder).toBe("codevo-editor");
    expect(dialog()?.textContent).toContain("The name is shown only in Codevo.");

    render();

    expect(dialog()).not.toBeNull();
    expect(nameInput().value).toBe("Flagship");
    expect(nameInput().placeholder).toBe("editor");
    expect(dialog()?.textContent).toContain("all 2 checkouts");

    press("Enter");

    expect(dialog()).toBeNull();
    expect(storedNames()).toEqual([
      [LOCAL, "Flagship"],
      [SERVER, "Flagship"],
    ]);
    expect(recorded.commands).toEqual([
      [{ projectRootKey: SERVER, repositoryRoot: SERVER, rootPath: SERVER }, "rename"],
    ]);
  });

  it("keeps a reset durable when a checkout was disconnected during the reset", () => {
    render();
    openRename("editor");
    typeInto(nameInput(), "Flagship");
    press("Enter");
    openRename("api");
    typeInto(nameInput(), "Flagship");
    press("Enter");

    render([MERGED[0]!, MERGED[2]!]);
    expect(searchSwitcher("")).toEqual(["All projects", "Flagship", "Flagship"]);
    openRename("Flagship");
    act(() => dialogButton("Reset to default")?.click());

    expect(storedEntries()).toEqual([[API, "Flagship", SECOND_TOKEN]]);
    expect(searchSwitcher("")).toEqual(["All projects", "editor", "Flagship"]);

    render();

    expect(searchSwitcher("")).toEqual(["All projects", "editor", "Flagship"]);
    expect(trigger().getAttribute("aria-label")).toBe("Switch project: editor");
  });

  it("keeps an unrelated offline project that has the same name when the displayed one is reset", () => {
    const serverOnly = project(SERVER, "codevo-editor");
    const api = MERGED[2]!;
    render([serverOnly, api]);
    openRename("codevo-editor");
    typeInto(nameInput(), "Billing API");
    press("Enter");
    openRename("api");
    typeInto(nameInput(), "Billing API");
    press("Enter");
    expect(storedEntries()).toEqual([
      [SERVER, "Billing API", FIRST_TOKEN],
      [API, "Billing API", SECOND_TOKEN],
    ]);

    render([api]);
    openRename("Billing API");
    act(() => dialogButton("Reset to default")?.click());

    expect(storedEntries()).toEqual([[SERVER, "Billing API", FIRST_TOKEN]]);
    expect(searchSwitcher("")).toEqual(["All projects", "api"]);

    render([serverOnly, api]);

    expect(searchSwitcher("")).toEqual(["All projects", "Billing API", "api"]);
  });

  it("renames a checkout that is offline at rename time so it follows the new name", () => {
    render();
    openRename("editor");
    typeInto(nameInput(), "Flagship");
    press("Enter");
    expect(storedEntries()).toEqual([
      [LOCAL, "Flagship", FIRST_TOKEN],
      [SERVER, "Flagship", FIRST_TOKEN],
    ]);

    render([project(LOCAL, "editor"), MERGED[2]!]);
    openRename("Flagship");
    expect(dialog()?.textContent).toContain(
      "The name applies to 2 checkouts of this project in Codevo, including 1 that is not connected right now. Folders and server projects are not renamed.",
    );
    typeInto(nameInput(), "Editor 2");
    press("Enter");

    expect(storedEntries()).toEqual([
      [LOCAL, "Editor 2", FIRST_TOKEN],
      [SERVER, "Editor 2", FIRST_TOKEN],
    ]);

    render([project(SERVER, "codevo-editor"), MERGED[2]!]);
    expect(searchSwitcher("")).toEqual(["All projects", "Editor 2", "api"]);

    render();
    expect(trigger().getAttribute("aria-label")).toBe("Switch project: Editor 2");
  });

  it("links every checkout of a renamed group with one token and other projects with another", () => {
    render();
    openRename("editor");
    typeInto(nameInput(), "Flagship");
    press("Enter");
    openRename("api");
    typeInto(nameInput(), "Flagship");
    press("Enter");
    openRename("Flagship");
    typeInto(nameInput(), "Flagship 2");
    press("Enter");

    expect(storedEntries()).toEqual([
      [LOCAL, "Flagship 2", FIRST_TOKEN],
      [SERVER, "Flagship 2", FIRST_TOKEN],
      [API, "Flagship", SECOND_TOKEN],
    ]);
    expect(generatedTokens).toBe(2);
  });

  it("refuses to rename over stored names it cannot read and leaves them untouched", () => {
    const newer = JSON.stringify({ version: 2, names: { [LOCAL]: "Newer" } });
    localStorage.setItem(PROJECT_DISPLAY_NAMES_STORAGE_KEY, newer);
    render();
    expect(trigger().getAttribute("aria-label")).toBe("Switch project: editor");

    openRename("editor");
    typeInto(nameInput(), "Flagship");
    press("Enter");

    expect(dialog()?.querySelector('[role="alert"]')?.textContent).toBe(
      "Saved project names could not be read, so nothing was changed.",
    );
    expect(localStorage.getItem(PROJECT_DISPLAY_NAMES_STORAGE_KEY)).toBe(newer);
  });

  it("leaves the other half alone when a grouped project is split and one half is renamed", () => {
    render();
    openRename("editor");
    typeInto(nameInput(), "Flagship");
    press("Enter");

    render([project(LOCAL, "editor"), project(SERVER, "codevo-editor"), MERGED[2]!]);
    expect(searchSwitcher("")).toEqual(["All projects", "Flagship", "Flagship", "api"]);
    act(() => trigger().click());
    const gears = document.querySelectorAll<HTMLButtonElement>(
      'button[aria-label="Project settings for Flagship"]',
    );
    act(() => gears[1]?.click());
    const rename = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (candidate) => candidate.textContent === "Rename project…",
    );
    act(() => rename?.click());
    expect(dialog()?.textContent).toContain("The name is shown only in Codevo.");
    typeInto(nameInput(), "Fork");
    press("Enter");

    expect(storedEntries()).toEqual([
      [LOCAL, "Flagship", FIRST_TOKEN],
      [SERVER, "Fork", SECOND_TOKEN],
    ]);
    expect(searchSwitcher("")).toEqual(["All projects", "Flagship", "Fork", "api"]);
  });

  it("leaves the other half alone when a grouped project is split and one half is reset", () => {
    render();
    openRename("editor");
    typeInto(nameInput(), "Flagship");
    press("Enter");

    render([project(LOCAL, "editor"), project(SERVER, "codevo-editor"), MERGED[2]!]);
    openRename("Flagship");
    expect(dialog()?.textContent).toContain("The name is shown only in Codevo.");
    act(() => dialogButton("Reset to default")?.click());

    expect(storedEntries()).toEqual([[SERVER, "Flagship", FIRST_TOKEN]]);
    expect(searchSwitcher("")).toEqual(["All projects", "editor", "Flagship", "api"]);
  });

  it("frees a project that a transient merge linked to another group", () => {
    const api = project(API, "api", IDENTITY);
    render([MERGED[0]!, MERGED[1]!, api]);
    expect(searchSwitcher("")).toEqual(["All projects", "editor"]);
    openRename("editor");
    expect(dialog()?.textContent).toContain("all 3 checkouts");
    typeInto(nameInput(), "Merged");
    press("Enter");
    expect(storedEntries()).toEqual([
      [LOCAL, "Merged", FIRST_TOKEN],
      [API, "Merged", FIRST_TOKEN],
      [SERVER, "Merged", FIRST_TOKEN],
    ]);

    render();
    expect(searchSwitcher("")).toEqual(["All projects", "Merged", "Merged"]);
    act(() => trigger().click());
    const gears = document.querySelectorAll<HTMLButtonElement>(
      'button[aria-label="Project settings for Merged"]',
    );
    act(() => gears[1]?.click());
    const rename = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (candidate) => candidate.textContent === "Rename project…",
    );
    act(() => rename?.click());
    typeInto(nameInput(), "API");
    press("Enter");

    expect(storedEntries()).toEqual([
      [LOCAL, "Merged", FIRST_TOKEN],
      [API, "API", SECOND_TOKEN],
      [SERVER, "Merged", FIRST_TOKEN],
    ]);

    openRename("Merged");
    act(() => dialogButton("Reset to default")?.click());

    expect(storedEntries()).toEqual([[API, "API", SECOND_TOKEN]]);
    expect(searchSwitcher("")).toEqual(["All projects", "editor", "API"]);
  });

  it("says how many checkouts change when some of them are not connected", () => {
    localStorage.setItem(
      PROJECT_DISPLAY_NAMES_STORAGE_KEY,
      JSON.stringify([
        [LOCAL, "Flagship", TOKEN_A],
        [SERVER, "Flagship", TOKEN_A],
        ["remote:backup:runner:codevo-editor", "Flagship", TOKEN_A],
        [API, "Backend", TOKEN_B],
      ]),
    );
    render([project(LOCAL, "editor"), MERGED[2]!]);

    openRename("Flagship");
    expect(dialog()?.textContent).toContain(
      "The name applies to 3 checkouts of this project in Codevo, including 2 that are not connected right now.",
    );
    press("Escape");

    openRename("Backend");
    expect(dialog()?.textContent).toContain("The name is shown only in Codevo.");
    press("Escape");

    render();
    openRename("Flagship");
    expect(dialog()?.textContent).toContain(
      "The name applies to 3 checkouts of this project in Codevo, including 1 that is not connected right now.",
    );
  });
});
