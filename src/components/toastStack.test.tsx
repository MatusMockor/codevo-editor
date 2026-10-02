// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgentThreadNotificationCenter } from "../application/agentThreadNotificationCenter";
import { createWorkbenchNotice } from "../application/workbenchNotice";
import { defaultKeymapSettings } from "../domain/keymap";
import { AgentThreadNotifications } from "./agentMode/AgentThreadNotifications";
import { AppShellRoot } from "./AppShellRoot";
import { parseCssRules, readStyleSheet } from "./cssContractTestSupport";
import { NoticeToastHost } from "./NoticeToastHost";

const WORKBENCH = {
  agentModeActive: true,
  appSettings: { agentThreadFontSize: 13, keymap: defaultKeymapSettings("linux") },
  runCommand: () => "missing" as const,
  settingsOpen: false,
  workspaceRoot: null,
};

function declarations(selector: string): ReadonlyMap<string, string> {
  const sheet = readStyleSheet("components/toastNotification.css");
  const rules = parseCssRules(sheet.source, sheet.sheet).rules.filter(
    (rule) => rule.selector === selector && rule.context.length === 0,
  );
  return new Map(
    rules.flatMap((rule) => rule.declarations.map((entry) => [entry.property, entry.value])),
  );
}

describe("shared toast stack", () => {
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

  it("collects workbench notices and agent thread cards in one themed column", () => {
    const center = createAgentThreadNotificationCenter({
      focus: { isFocused: () => true, subscribe: () => () => undefined },
      system: {
        notify: async () => "delivered",
        setBadgeCount: async () => undefined,
        recheckPermission: () => undefined,
      },
    });
    act(() =>
      root.render(
        <AppShellRoot colorScheme="dark" shellStyle={{}} workbench={WORKBENCH}>
          <AgentThreadNotifications
            center={center}
            interactions={new Map()}
            onSelectThread={() => undefined}
            projects={[]}
            views={[]}
            visibleThreadId={null}
          />
          <NoticeToastHost
            notices={[createWorkbenchNotice("error", "Git", "Push failed")]}
            renderNotice={(notice) => <p>{notice.message}</p>}
          />
        </AppShellRoot>,
      ),
    );
    act(() =>
      center.reportUnavailable({
        threadId: "gone",
        ownerKey: "owner",
        title: "Old work",
        projectLabel: "api",
        kind: "completed",
        signalKey: "s",
        key: "k",
      }),
    );

    const stack = host.querySelector<HTMLElement>(".app-shell > .toast-stack");
    expect(stack).not.toBeNull();
    const regions = [...(stack?.children ?? [])];
    expect(regions.every((region) => region.classList.contains("toast-region"))).toBe(true);
    const agent = regions.filter((region) =>
      region.classList.contains("toast-region--agent-threads"),
    );
    const notices = regions.filter(
      (region) => !region.classList.contains("toast-region--agent-threads"),
    );
    expect(
      agent.map((region) => region.querySelector(".toast-notification__title")?.textContent),
    ).toEqual(["Thread unavailable"]);
    expect(notices.map((region) => region.textContent)).toEqual(["Push failed"]);
    expect(host.querySelectorAll(".toast-region")).toHaveLength(2);
  });

  it("lays the regions out in a fixed column instead of overlapping them", () => {
    const stack = declarations(".toast-stack");
    expect(stack.get("position")).toBe("fixed");
    expect(stack.get("z-index")).toBe("var(--cv-z-toast)");
    expect(stack.get("display")).toBe("flex");
    expect(stack.get("flex-direction")).toBe("column");
    expect(declarations(".toast-region").get("position")).toBe("relative");
    expect(declarations(".toast-region--agent-threads").get("order")).toBe("1");
    expect(declarations(".app-shell").get("--toast-top")).toBeDefined();
  });
});
