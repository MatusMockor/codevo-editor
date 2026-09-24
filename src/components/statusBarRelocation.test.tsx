// @vitest-environment jsdom

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountUi, type MountedUi } from "../ui/foundation/foundationTestSupport";
import { initialIndexProgress } from "../domain/indexProgress";
import { defaultStatusBarItemVisibility, type StatusBarItemVisibility } from "../domain/settings";
import { AgentSidebarReveal } from "./agentMode/AgentSidebarReveal";
import { AgentThreadActivity } from "./agentMode/AgentThreadActivity";
import { agentThreadActivityDetail } from "./agentMode/agentThreadActivityPresentation";
import { StatusBar } from "./StatusBar";
import { WorkbenchToolbar } from "./WorkbenchToolbar";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

type StatusItemHome =
  | "editorToolbarStatus"
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
  { item: "problems", source: "editor", visibilityKeys: [], homes: ["editorToolbarStatus"] },
  {
    item: "git branch",
    source: "editor",
    visibilityKeys: ["gitBranch"],
    homes: ["editorToolbarStatus"],
  },
  {
    item: "active path",
    source: "editor",
    visibilityKeys: ["activePath"],
    homes: ["editorToolbarStatus"],
  },
  {
    item: "workspace info",
    source: "editor",
    visibilityKeys: ["workspaceInfo"],
    homes: ["editorToolbarStatus"],
  },
  {
    item: "ide activity",
    source: "editor",
    visibilityKeys: ["index", "languageServer"],
    homes: ["editorToolbarStatus"],
  },
  { item: "node run", source: "editor", visibilityKeys: [], homes: ["editorToolbarStatus"] },
  {
    item: "trust",
    source: "editor",
    visibilityKeys: ["workspaceTrust"],
    homes: ["editorToolbarStatus"],
  },
  { item: "mode", source: "editor", visibilityKeys: ["mode"], homes: ["editorToolbarStatus"] },
  {
    item: "large file",
    source: "editor",
    visibilityKeys: ["largeFileMode"],
    homes: ["editorToolbarStatus"],
  },
  {
    item: "cursor",
    source: "editor",
    visibilityKeys: ["cursorPosition"],
    homes: ["editorToolbarStatus"],
  },
  {
    item: "language",
    source: "editor",
    visibilityKeys: ["language"],
    homes: ["editorToolbarStatus"],
  },
  {
    item: "unsaved",
    source: "editor",
    visibilityKeys: ["dirtyCount"],
    homes: ["editorToolbarStatus"],
  },
  {
    item: "messages",
    source: "editor",
    visibilityKeys: ["message"],
    homes: ["editorToolbarStatus"],
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

  it("renders every editor item inside the editor toolbar status group", () => {
    mounted = mountUi();
    mounted.render(
      <WorkbenchToolbar
        collapseAvailable
        ideProgress={{ busy: false, state: "idle", text: null }}
        indexProgress={initialIndexProgress()}
        intelligenceMode="fullSmart"
        languageServerPlan={null}
        languageServerRuntimeStatus={null}
        layout="editor-expanded"
        onCollapseEditor={vi.fn()}
        onShowProgressPanel={vi.fn()}
        onToggleSmartMode={vi.fn()}
        onTrustWorkspace={vi.fn()}
        status={
          <StatusBar
            activeLanguage="TypeScript"
            activePath="/w/src/app.ts"
            cursorPosition={{ lineNumber: 3, column: 7 }}
            dirtyCount={2}
            errorCount={1}
            gitBranch="main"
            ideActivityDetail="PHPactor: Off"
            ideActivityLabel="Indexing 40%"
            ideActivityState="scanning"
            intelligenceMode="fullSmart"
            largeDocumentStatus={{ label: "Large file", title: "Large file mode" }}
            message="Saved app.ts"
            onChangeVisibility={vi.fn()}
            statusBar={defaultStatusBarItemVisibility()}
            warningCount={4}
            workspaceInfoLabel="orders-api · TS 5.8"
            workspaceRoot="/w"
            workspaceTrustLabel="Trusted"
          />
        }
        workspaceRoot="/w"
        workspaceTrusted
      />,
    );

    const group = mounted.host.querySelector(
      '.workbench-toolbar .editor-status[role="group"][aria-label="Editor status"]',
    );
    const text = group?.textContent ?? "";
    for (const expected of [
      "main",
      "src/app.ts",
      "orders-api · TS 5.8",
      "Indexing 40%",
      "Trusted",
      "IDE Mode",
      "Large file",
      "Ln 3, Col 7",
      "TypeScript",
      "2 unsaved",
      "Saved app.ts",
    ]) {
      expect(text, expected).toContain(expected);
    }
    expect(group?.querySelector('button[aria-label="1 error, 4 warnings"]')).not.toBeNull();
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
  });
});
