// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { click, mountUi, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import type { EditorChrome } from "./EditorChromeContext";
import { chromeFixture } from "./editorChromeTestSupport";
import { EditorMoreMenu } from "./EditorMoreMenu";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let mounted: MountedUi | null = null;
let anchor: HTMLButtonElement | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  anchor?.remove();
  anchor = null;
});

function openMenu(chrome: EditorChrome = chromeFixture()) {
  anchor = document.createElement("button");
  document.body.append(anchor);
  const anchorRef = { current: anchor };
  mounted = mountUi();
  mounted.render(
    <EditorMoreMenu anchorRef={anchorRef} chrome={chrome} onClose={() => undefined} open />,
  );
  const menu = document.body.querySelector<HTMLElement>(
    '[role="menu"][aria-label="More editor actions"]',
  );
  return { chrome, menu };
}

function item(menu: HTMLElement | null, prefix: string): HTMLElement {
  const found = [
    ...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"]') ?? []),
  ].find((candidate) => candidate.textContent?.startsWith(prefix));
  expect(found, `missing menu item ${prefix}`).toBeDefined();
  return found as HTMLElement;
}

describe("EditorMoreMenu", () => {
  it("offers every debug entry point with its shortcut", () => {
    const { chrome, menu } = openMenu();

    expect(item(menu, "Start debugging").textContent).toContain("F5");
    expect(item(menu, "Run without debugging").textContent).toContain("⌃F5");
    item(menu, "Launch configurations");
    item(menu, "Attach to Node process");
    item(menu, "Show debug views");
    click(item(menu, "Start debugging"));
    expect(chrome.runDebugEntry).toHaveBeenCalledWith("start");
  });

  it.each([
    ["Run without debugging", "runWithoutDebugging"],
    ["Launch configurations", "launchConfigurations"],
    ["Attach to Node process", "attach"],
    ["Show debug views", "showViews"],
  ] as const)("maps %s to the %s debug entry", (label, entry) => {
    const { chrome, menu } = openMenu();
    click(item(menu, label));

    expect(chrome.runDebugEntry).toHaveBeenCalledWith(entry);
  });

  it("splits the editor right and down", () => {
    const { chrome, menu } = openMenu();
    click(item(menu, "Split right"));
    click(item(menu, "Split down"));

    expect(chrome.splitRight).toHaveBeenCalledTimes(1);
    expect(chrome.splitDown).toHaveBeenCalledTimes(1);
  });

  it("lists every editor status readout in the Editor status section", () => {
    const { menu } = openMenu(
      chromeFixture({
        statusRows: [
          { id: "language", label: "Language", value: "TypeScript" },
          { id: "branch", label: "Branch", value: "main" },
        ],
      }),
    );

    expect(menu?.textContent).toContain("Editor status");
    expect(menu?.textContent).toContain("LanguageTypeScript");
    expect(menu?.textContent).toContain("Branchmain");
  });

  it("omits the Editor status section when there is nothing to show", () => {
    const { menu } = openMenu(chromeFixture({ statusRows: [] }));

    expect(menu?.textContent).not.toContain("Editor status");
  });

  it("toggles IDE mode and offers Trust only when the workspace is untrusted", () => {
    const chrome = chromeFixture({ trustNeeded: true });
    const { menu } = openMenu(chrome);
    const ideMode = item(menu, "IDE mode");

    expect(ideMode.getAttribute("role")).toBe("menuitemcheckbox");
    expect(ideMode.getAttribute("aria-checked")).toBe("true");
    click(ideMode);
    expect(chrome.toggleIdeMode).toHaveBeenCalledTimes(1);
    click(item(menu, "Trust workspace…"));
    expect(chrome.trustWorkspace).toHaveBeenCalledTimes(1);
  });

  it("reports IDE mode off and hides Trust for a trusted workspace", () => {
    const { menu } = openMenu(chromeFixture({ ideModeOn: false, trustNeeded: false }));

    expect(item(menu, "IDE mode").getAttribute("aria-checked")).toBe("false");
    expect(menu?.textContent).not.toContain("Trust workspace…");
  });

  it("opens the branch picker from the Branch row", () => {
    const chrome = chromeFixture({
      statusRows: [{ id: "branch", label: "Branch", value: "main · api" }],
    });
    const { menu } = openMenu(chrome);
    const branch = [...(menu?.querySelectorAll('[role="menuitem"]') ?? [])].find((candidate) =>
      candidate.textContent?.includes("main · api"),
    );
    expect(branch, "missing Branch menu item").toBeDefined();
    click(branch as Element);

    expect(chrome.openBranches).toHaveBeenCalledTimes(1);
  });

  it("keeps the other status rows presentational", () => {
    const { menu } = openMenu(
      chromeFixture({ statusRows: [{ id: "language", label: "Language", value: "TypeScript" }] }),
    );
    const items = [...(menu?.querySelectorAll('[role="menuitem"]') ?? [])];

    expect(items.some((candidate) => candidate.textContent?.includes("TypeScript"))).toBe(false);
    expect(menu?.textContent).toContain("LanguageTypeScript");
  });
});
