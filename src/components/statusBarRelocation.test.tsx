// @vitest-environment jsdom

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { click, mountUi, type MountedUi } from "../ui/foundation/foundationTestSupport";
import { defaultStatusBarItemVisibility, type StatusBarItemVisibility } from "../domain/settings";
import { AgentSidebarReveal } from "./agentMode/AgentSidebarReveal";
import { AgentThreadActivity } from "./agentMode/AgentThreadActivity";
import { agentThreadActivityDetail } from "./agentMode/agentThreadActivityPresentation";
import { EditorChromeContext } from "./editorPanel/EditorChromeContext";
import { chromeFixture } from "./editorPanel/editorChromeTestSupport";
import { EditorSubheader } from "./editorPanel/EditorSubheader";
import { editorStatusRows } from "./editorPanel/editorStatusRows";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

type StatusItemHome =
  | "editorSubheader"
  | "editorMoreMenu"
  | "composerBranch"
  | "editorToast"
  | "sidebarThreadActivity"
  | "expandSidebarTooltip"
  | "threadActivityMenu"
  | "providerSettingsTooltip"
  | "settingsProviders"
  | "settingsAgents"
  | "composerLaunchControls"
  | "topBarBreadcrumb"
  | "toasts";

interface RelocatedItem {
  readonly item: string;
  readonly source: "editor" | "agent";
  readonly visibilityKeys: ReadonlyArray<keyof StatusBarItemVisibility>;
  readonly homes: ReadonlyArray<StatusItemHome>;
}

const INVENTORY: ReadonlyArray<RelocatedItem> = [
  {
    item: "thread slots",
    source: "agent",
    visibilityKeys: [],
    homes: ["sidebarThreadActivity", "expandSidebarTooltip", "settingsAgents"],
  },
  {
    item: "attention",
    source: "agent",
    visibilityKeys: ["agentAttention"],
    homes: ["sidebarThreadActivity", "expandSidebarTooltip"],
  },
  {
    item: "visibility menu",
    source: "agent",
    visibilityKeys: ["agentAttention"],
    homes: ["threadActivityMenu"],
  },
  { item: "launch label", source: "agent", visibilityKeys: [], homes: ["composerLaunchControls"] },
  {
    item: "cli version",
    source: "agent",
    visibilityKeys: [],
    homes: ["providerSettingsTooltip", "settingsProviders"],
  },
  { item: "workspace name", source: "agent", visibilityKeys: [], homes: ["topBarBreadcrumb"] },
  { item: "problems", source: "editor", visibilityKeys: [], homes: ["editorSubheader"] },
  {
    item: "git branch",
    source: "editor",
    visibilityKeys: ["gitBranch"],
    homes: ["editorMoreMenu", "composerBranch"],
  },
  {
    item: "active path",
    source: "editor",
    visibilityKeys: ["activePath"],
    homes: ["editorSubheader"],
  },
  {
    item: "workspace info",
    source: "editor",
    visibilityKeys: ["workspaceInfo"],
    homes: ["editorMoreMenu"],
  },
  {
    item: "ide activity",
    source: "editor",
    visibilityKeys: ["index", "languageServer"],
    homes: ["editorSubheader"],
  },
  { item: "node run", source: "editor", visibilityKeys: [], homes: ["editorSubheader"] },
  {
    item: "trust",
    source: "editor",
    visibilityKeys: ["workspaceTrust"],
    homes: ["editorMoreMenu"],
  },
  { item: "mode", source: "editor", visibilityKeys: ["mode"], homes: ["editorMoreMenu"] },
  {
    item: "large file",
    source: "editor",
    visibilityKeys: ["largeFileMode"],
    homes: ["editorMoreMenu"],
  },
  {
    item: "cursor",
    source: "editor",
    visibilityKeys: ["cursorPosition"],
    homes: ["editorSubheader"],
  },
  {
    item: "language",
    source: "editor",
    visibilityKeys: ["language"],
    homes: ["editorMoreMenu"],
  },
  {
    item: "unsaved",
    source: "editor",
    visibilityKeys: ["dirtyCount"],
    homes: ["editorMoreMenu"],
  },
  {
    item: "messages",
    source: "editor",
    visibilityKeys: ["message"],
    homes: ["editorToast"],
  },
  { item: "update notices", source: "agent", visibilityKeys: [], homes: ["toasts"] },
];

let mounted: MountedUi | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe("status bar removal inventory", () => {
  it("gives every former status bar item and every visibility key a home", () => {
    const covered = new Set(INVENTORY.flatMap((entry) => entry.visibilityKeys));
    const keys = Object.keys(defaultStatusBarItemVisibility()) as Array<
      keyof StatusBarItemVisibility
    >;

    expect(keys.filter((key) => !covered.has(key))).toEqual([]);
    expect(INVENTORY.filter((entry) => entry.homes.length === 0)).toEqual([]);
    expect(new Set(INVENTORY.map((entry) => entry.item)).size).toBe(INVENTORY.length);
  });

  it("renders every editor item in the editor sub-header or its More menu", () => {
    const chrome = chromeFixture({
      diagnostics: { errors: 1, warnings: 4 },
      activity: { label: "Indexing 40%", state: "scanning", detail: null },
      nodeRun: { canStop: true, label: "Running dev", phase: "running", stopLabel: "Stop dev" },
      statusRows: editorStatusRows({
        activeLanguage: "TypeScript",
        workspaceLabel: "orders-api · TS 5.8",
        gitBranch: "main",
        branchRepositoryLabel: null,
        workspaceTrustLabel: "Trusted",
        intelligenceMode: "fullSmart",
        largeDocumentStatus: { label: "Large file", title: "Large file mode" },
        dirtyCount: 2,
      }),
    });
    mounted = mountUi();
    mounted.render(
      <EditorChromeContext.Provider value={chrome}>
        <EditorSubheader
          documentPath="/w/src/app.ts"
          groupId="editor-main"
          onFind={vi.fn()}
          rootPath="/w"
          symbols={null}
        />
      </EditorChromeContext.Provider>,
    );
    const subheader = mounted.host.querySelector(".cv-esub");

    expect(subheader?.textContent).toContain("src");
    expect(subheader?.textContent).toContain("app.ts");
    expect(subheader?.textContent).toContain("Running dev");
    expect(
      subheader?.querySelector('button[aria-label="1 error, 4 warnings. Show problems"]'),
    ).not.toBeNull();
    expect(subheader?.querySelector('button[aria-label="Indexing 40%"]')).not.toBeNull();
    click(subheader?.querySelector('button[aria-label="More editor actions"]') as Element);
    const menu = document.body.querySelector('[role="menu"][aria-label="More editor actions"]');
    for (const expected of [
      "TypeScript",
      "orders-api · TS 5.8",
      "main",
      "Trusted",
      "IDE Mode",
      "Large file",
      "2 files",
    ]) {
      expect(menu?.textContent, expected).toContain(expected);
    }
    expect(mounted.host.querySelector("footer")).toBeNull();
  });

  it("shows running and attention in the sidebar footer activity and the expand tooltip", () => {
    const summary = { live: 2, capacity: 4, attention: 1, attentionExplanation: "1 failed." };
    mounted = mountUi();
    mounted.render(
      <>
        <AgentThreadActivity
          attentionVisible
          onChangeAttentionVisible={vi.fn()}
          ownerKey="/w"
          summary={summary}
        />
        <AgentSidebarReveal
          detail={agentThreadActivityDetail(summary, true)}
          onExpand={vi.fn()}
          onNewThread={vi.fn()}
          shortcuts={{
            bottomPanel: "Cmd+J",
            rightPanel: "Cmd+Alt+R",
            sidebar: "Cmd+B",
            newThread: "Cmd+N",
          }}
        />
      </>,
    );

    expect(mounted.host.querySelector(".agent-thread-activity")?.textContent).toContain(
      "2 running",
    );
    expect(mounted.host.querySelector(".agent-thread-activity")?.textContent).toContain(
      "1 needs attention",
    );
    expect(
      mounted.host.querySelector<HTMLButtonElement>('button[aria-label="Expand sidebar"]')?.title,
    ).toContain("2 running · 1 needs attention");
  });

  it("leaves no status bar row, stylesheet or component behind", () => {
    const root = resolve(import.meta.dirname, "../..");
    const appCss = readFileSync(resolve(root, "src/App.css"), "utf8");
    const skeleton = readFileSync(resolve(root, "index.html"), "utf8");

    expect(existsSync(resolve(root, "src/components/agentMode/agentStatusBar.css"))).toBe(false);
    expect(existsSync(resolve(root, "src/components/agentMode/AgentStatusBar.tsx"))).toBe(false);
    expect(existsSync(resolve(root, "src/components/agentMode/AgentStatusBarHost.tsx"))).toBe(
      false,
    );
    expect(appCss).not.toMatch(/\.status-bar\s*\{/);
    expect(appCss).not.toContain("status-bar--agent");
    expect(skeleton).not.toContain("startup-skeleton__status");
    for (const removed of [
      "src/components/StatusBar.tsx",
      "src/components/WorkbenchToolbar.tsx",
      "src/components/WorkbenchNavigationChrome.tsx",
      "src/components/WorkbenchActivityBar.tsx",
      "src/components/WorkbenchSidebar.tsx",
      "src/application/useAgentEditorCollapse.ts",
    ]) {
      expect(existsSync(resolve(root, removed)), removed).toBe(false);
    }
    expect(appCss).not.toContain(".editor-status");
    expect(appCss).not.toContain(".activity-bar");
    expect(appCss).not.toContain(".workbench-toolbar");
  });
});
