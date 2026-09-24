// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { plainText, type PaletteGroup } from "../../domain/commandPalette/paletteItem";
import { palettePageCopy } from "../../domain/commandPalette/palettePages";
import { CommandSurface } from "../../ui/foundation/CommandList";
import { click, mountUi, press, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import { CommandPalettePage, type CommandPalettePageProps } from "./CommandPalettePage";

let ui: MountedUi | null = null;

afterEach(() => {
  ui?.unmount();
  ui = null;
  document.body.replaceChildren();
});

const groups: readonly PaletteGroup[] = [
  {
    key: "actions",
    label: "Actions",
    items: [
      {
        key: "a",
        intent: { kind: "command", commandId: "agent.newThread" },
        icon: { kind: "glyph", glyph: "newThread" },
        title: { text: "New thread", ranges: [{ start: 0, end: 3 }], style: "token" },
        description: null,
        timestamp: null,
        shortcut: "⌘N",
        current: false,
        disabled: false,
      },
      {
        key: "b",
        intent: { kind: "page", page: "switchProject" },
        icon: { kind: "glyph", glyph: "folder" },
        title: plainText("Switch project"),
        description: null,
        timestamp: null,
        shortcut: null,
        current: false,
        disabled: false,
      },
    ],
  },
  {
    key: "recent",
    label: "Recent Threads",
    items: [
      {
        key: "t",
        intent: { kind: "openThread", threadId: "t1" },
        icon: { kind: "glyph", glyph: "message" },
        title: plainText("Idempotency keys"),
        description: plainText("orders-api · Current thread"),
        timestamp: "4m",
        shortcut: null,
        current: false,
        disabled: false,
      },
    ],
  },
];

function props(overrides: Partial<CommandPalettePageProps> = {}): CommandPalettePageProps {
  return {
    page: "root",
    query: "",
    groups,
    copy: palettePageCopy("root", false),
    canGoBack: false,
    generation: 1,
    onQueryChange: vi.fn(),
    onBack: vi.fn(),
    onExecute: vi.fn(),
    onLocalShortcut: () => false,
    ...overrides,
  };
}

function render(overrides: Partial<CommandPalettePageProps> = {}) {
  const value = props(overrides);
  ui = mountUi();
  ui.render(
    <CommandSurface label="Command palette" onClose={vi.fn()}>
      <CommandPalettePage {...value} />
    </CommandSurface>,
  );
  return value;
}

function input(): HTMLInputElement {
  return document.querySelector(".cv-command-field input") as HTMLInputElement;
}

describe("CommandPalettePage", () => {
  it("renders groups, highlight marks, timestamps, shortcuts and submenu chevrons", () => {
    render();
    expect(
      [...document.querySelectorAll(".cv-command-group__label")].map((node) => node.textContent),
    ).toEqual(["Actions", "Recent Threads"]);
    expect(document.querySelector(".cv-command-item mark")?.textContent).toBe("New");
    expect(document.querySelector(".cv-command-item__timestamp")?.textContent).toBe("4m");
    expect(document.querySelectorAll(".cv-command-item__chevron")).toHaveLength(1);
    expect(input().placeholder).toBe("Search commands, projects, threads, and files…");
  });

  it("executes the active item on Enter and a clicked item", () => {
    const value = render();
    press(input(), "ArrowDown");
    press(input(), "Enter");
    click(document.querySelectorAll('[role="option"]')[2] as Element);
    expect(value.onExecute).toHaveBeenNthCalledWith(1, groups[0]?.items[1]);
    expect(value.onExecute).toHaveBeenNthCalledWith(2, groups[1]?.items[0]);
  });

  it("keeps Enter on the highlighted item when async results insert rows above it", () => {
    const value = props();
    ui = mountUi();
    const view = (next: readonly PaletteGroup[]) => (
      <CommandSurface label="Command palette" onClose={vi.fn()}>
        <CommandPalettePage {...value} groups={next} />
      </CommandSurface>
    );
    ui.render(view(groups));
    press(input(), "ArrowDown");
    press(input(), "ArrowDown");
    const thread = groups[1]?.items[0];

    const inserted = {
      ...groups[0],
      key: "files",
      label: "Files",
      items: [{ ...(groups[0]?.items[0] as PaletteGroup["items"][number]), key: "file:x" }],
    } as PaletteGroup;
    ui.render(view([inserted, ...groups]));
    press(input(), "Enter");

    expect(value.onExecute).toHaveBeenCalledWith(thread);
  });

  it("announces the result count in a polite live region", () => {
    render();
    expect(document.querySelector('[aria-live="polite"]')?.textContent).toBe("3 results");
  });

  it("goes back on Backspace with an empty query and shows the back footer hint", () => {
    const value = render({
      page: "switchProject",
      canGoBack: true,
      copy: palettePageCopy("switchProject", false),
    });
    press(input(), "Backspace");
    expect(value.onBack).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".cv-command-footer")?.textContent).toContain("Back");
    expect(document.querySelector('button[aria-label="Back"]')).not.toBeNull();
  });

  it("renders the page empty copy when there are no groups", () => {
    render({ groups: [], query: "kubectl rollout" });
    expect(document.querySelector(".cv-command-empty")?.textContent).toBe(
      "No matching commands, projects, threads, or files.",
    );
  });

  it("lets the host consume palette shortcuts before list navigation", () => {
    const onLocalShortcut = vi.fn(() => true);
    const value = render({ onLocalShortcut });
    press(input(), "k", { metaKey: true });
    expect(onLocalShortcut).toHaveBeenCalledTimes(1);
    expect(value.onExecute).not.toHaveBeenCalled();
  });
});
