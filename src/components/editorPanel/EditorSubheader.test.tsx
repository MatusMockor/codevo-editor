// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { click, mountUi, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import { EditorChromeContext, type EditorChrome } from "./EditorChromeContext";
import { chromeFixture } from "./editorChromeTestSupport";
import { EditorSubheader } from "./EditorSubheader";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let mounted: MountedUi | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

function renderSubheader(chrome: EditorChrome | null, groupId: string | null = "editor-main") {
  mounted = mountUi();
  mounted.render(
    <EditorChromeContext.Provider value={chrome}>
      <EditorSubheader
        documentPath="/w/orders-api/src/routes/orders.ts"
        groupId={groupId}
        onFind={vi.fn()}
        rootPath="/w/orders-api"
        symbols={<span data-testid="symbols">router.post("/orders")</span>}
      />
    </EditorChromeContext.Provider>,
  );
  return mounted.host;
}

function crumbButtons(host: HTMLElement): HTMLButtonElement[] {
  return [
    ...host.querySelectorAll<HTMLButtonElement>('nav[aria-label="Breadcrumbs"] .cv-esub__crumb'),
  ];
}

describe("EditorSubheader", () => {
  it("renders folder and file crumbs, then the symbol crumbs", () => {
    const host = renderSubheader(chromeFixture());
    const crumbs = host.querySelector('nav[aria-label="Breadcrumbs"]');

    expect(crumbButtons(host).map((button) => button.textContent)).toEqual([
      "src",
      "routes",
      "orders.ts",
    ]);
    expect(host.querySelector(".cv-esub__crumb--current")?.textContent).toBe("orders.ts");
    expect(crumbs?.querySelector('[data-testid="symbols"]')).not.toBeNull();
  });

  it("reveals the file in the Files surface from a crumb", () => {
    const chrome = chromeFixture();
    const host = renderSubheader(chrome);
    const first = crumbButtons(host)[0];
    expect(first).toBeDefined();
    click(first as Element);

    expect(chrome.revealInFiles).toHaveBeenCalledTimes(1);
  });

  it("shows the hover actions only on the active group", () => {
    expect(renderSubheader(chromeFixture()).querySelector(".cv-esub__acts")).not.toBeNull();
    mounted?.unmount();

    expect(renderSubheader(chromeFixture(), "editor-2").querySelector(".cv-esub__acts")).toBeNull();
  });

  it("still renders inert crumbs without a chrome provider", () => {
    const host = renderSubheader(null);

    expect(crumbButtons(host)).toHaveLength(3);
    click(crumbButtons(host)[0] as Element);
    expect(host.querySelector(".cv-esub__acts")).toBeNull();
  });
});
