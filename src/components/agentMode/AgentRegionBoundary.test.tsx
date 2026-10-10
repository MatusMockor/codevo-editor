// @vitest-environment jsdom

import { act, useLayoutEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TextClipboardGateway } from "../../domain/textClipboard";
import { AgentRegionBoundary } from "./AgentRegionBoundary";
import {
  AGENT_REGION_FAILURE_DETAILS_MAX_CHARS,
  agentRegionFailureTitle,
  type AgentRegion,
} from "./agentRegionFailurePresentation";
import {
  captureConsoleErrors,
  expectNoUnexpectedConsoleErrors,
  expectOnlyCaughtErrorReports,
  type ConsoleErrorSpy,
} from "../errorBoundaryTestSupport";
import { regionFallback, regionFallbackAction } from "./agentRegionBoundaryTestSupport";

const REGIONS: ReadonlyArray<AgentRegion> = ["sidebar", "conversation", "composer", "rightPanel"];
const RAW_FAILURE =
  "Minified React error #185; visit https://react.dev/errors/185 for the full message";

type Crash = { readonly region: AgentRegion; readonly kind: "throw" | "updateLoop" } | null;

interface WorkbenchProps {
  readonly crash: Crash;
  readonly clipboard: TextClipboardGateway | null;
  readonly resetKey?: string;
  readonly rightPanelHidden?: boolean;
}

function recordingClipboard(): TextClipboardGateway & { readonly written: string[] } {
  const written: string[] = [];
  return {
    written,
    canWriteText: () => true,
    writeText: async (text) => {
      written.push(text);
    },
  };
}

function Exploding(): never {
  throw new Error(RAW_FAILURE);
}

function FreshValueSource({ onChange }: { onChange(value: object): void }) {
  useLayoutEffect(() => {
    onChange({});
  });
  return null;
}

function UpdateLoop() {
  const [value, setValue] = useState<object>({});
  return (
    <>
      <FreshValueSource onChange={setValue} />
      <output>{Object.keys(value).length}</output>
    </>
  );
}

function RegionProbe({ region, crash }: { readonly region: AgentRegion; readonly crash: Crash }) {
  const [presses, setPresses] = useState(0);
  if (crash?.region === region && crash.kind === "throw") return <Exploding />;
  return (
    <>
      {crash?.region === region && <UpdateLoop />}
      <button
        data-probe={region}
        onClick={() => setPresses((current) => current + 1)}
        type="button"
      >
        {presses}
      </button>
    </>
  );
}

function Workbench({
  crash,
  clipboard,
  resetKey = "thread-a",
  rightPanelHidden = false,
}: WorkbenchProps) {
  return (
    <main>
      {REGIONS.map((region) => (
        <AgentRegionBoundary
          clipboard={clipboard}
          hidden={region === "rightPanel" && rightPanelHidden}
          key={region}
          region={region}
          resetKeys={[resetKey]}
        >
          <RegionProbe crash={crash} region={region} />
        </AgentRegionBoundary>
      ))}
    </main>
  );
}

describe("AgentRegionBoundary", () => {
  let host: HTMLDivElement;
  let root: Root;
  let consoleError: ConsoleErrorSpy;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    consoleError = captureConsoleErrors();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    try {
      expectNoUnexpectedConsoleErrors(consoleError);
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  function render(props: WorkbenchProps): void {
    act(() => root.render(<Workbench {...props} />));
  }

  function probe(region: AgentRegion): HTMLButtonElement | null {
    return host.querySelector<HTMLButtonElement>(`button[data-probe="${region}"]`);
  }

  function press(region: AgentRegion): void {
    const button = probe(region);
    expect(button).not.toBeNull();
    act(() => button?.click());
  }

  function click(region: AgentRegion, action: "retry" | "copy-details"): void {
    const button = regionFallbackAction(host, region, action);
    expect(button).not.toBeNull();
    act(() => button?.click());
  }

  async function clickAndSettle(region: AgentRegion, action: "copy-details"): Promise<void> {
    const button = regionFallbackAction(host, region, action);
    expect(button).not.toBeNull();
    await act(async () => button?.click());
  }

  it.each(REGIONS)("keeps the other regions usable when the %s throws", (failed) => {
    render({ crash: { region: failed, kind: "throw" }, clipboard: recordingClipboard() });

    const fallback = regionFallback(host, failed);
    expect(fallback).not.toBeNull();
    expect(fallback?.getAttribute("role")).toBe("alert");
    expect(fallback?.querySelector("p")?.textContent).toBe(agentRegionFailureTitle(failed));
    expect(host.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(probe(failed)).toBeNull();

    for (const healthy of REGIONS.filter((region) => region !== failed)) {
      press(healthy);
      expect(probe(healthy)?.textContent).toBe("1");
    }
    expectOnlyCaughtErrorReports(consoleError, 1);
  });

  it("keeps the raw error text out of the visible fallback", () => {
    render({ crash: { region: "composer", kind: "throw" }, clipboard: recordingClipboard() });

    expect(host.textContent).not.toContain("Minified React error");
    expect(host.textContent).not.toContain("react.dev");
    expect(regionFallback(host, "composer")?.textContent).toBe(
      "The composer couldn't be displayedTry againCopy details",
    );
    expectOnlyCaughtErrorReports(consoleError, 1);
  });

  it("offers keyboard-focusable actions in reading order", () => {
    render({ crash: { region: "conversation", kind: "throw" }, clipboard: recordingClipboard() });

    const buttons = [
      ...(regionFallback(host, "conversation")?.querySelectorAll<HTMLButtonElement>("button") ??
        []),
    ];
    expect(buttons.map((button) => button.textContent)).toEqual(["Try again", "Copy details"]);
    for (const button of buttons) {
      expect(button.type).toBe("button");
      expect(button.disabled).toBe(false);
      expect(button.tabIndex).toBe(0);
      button.focus();
      expect(document.activeElement).toBe(button);
    }
    expectOnlyCaughtErrorReports(consoleError, 1);
  });

  it("remounts the region when Try again is pressed after the cause is gone", () => {
    const clipboard = recordingClipboard();
    render({ crash: { region: "sidebar", kind: "throw" }, clipboard });
    press("composer");

    render({ crash: null, clipboard });
    expect(regionFallback(host, "sidebar")).not.toBeNull();

    click("sidebar", "retry");

    expect(regionFallback(host, "sidebar")).toBeNull();
    expect(probe("sidebar")?.textContent).toBe("0");
    expect(probe("composer")?.textContent).toBe("1");
    expectOnlyCaughtErrorReports(consoleError, 1);
  });

  it("retries once per press and never on its own", () => {
    vi.useFakeTimers();
    render({ crash: { region: "composer", kind: "throw" }, clipboard: recordingClipboard() });
    expectOnlyCaughtErrorReports(consoleError, 1);

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expectOnlyCaughtErrorReports(consoleError, 1);
    expect(vi.getTimerCount()).toBe(0);

    click("composer", "retry");

    expect(regionFallback(host, "composer")).not.toBeNull();
    expectOnlyCaughtErrorReports(consoleError, 2);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expectOnlyCaughtErrorReports(consoleError, 2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("recovers when a reset key changes and stays failed while it does not", () => {
    const clipboard = recordingClipboard();
    render({ crash: { region: "conversation", kind: "throw" }, clipboard, resetKey: "thread-a" });

    render({ crash: null, clipboard, resetKey: "thread-a" });
    expect(regionFallback(host, "conversation")).not.toBeNull();

    render({ crash: null, clipboard, resetKey: "thread-b" });
    expect(regionFallback(host, "conversation")).toBeNull();
    expect(probe("conversation")).not.toBeNull();
    expectOnlyCaughtErrorReports(consoleError, 1);
  });

  it("shows the fallback again when the region still fails after a reset key change", () => {
    const clipboard = recordingClipboard();
    const crash: Crash = { region: "conversation", kind: "throw" };
    render({ crash, clipboard, resetKey: "thread-a" });

    render({ crash, clipboard, resetKey: "thread-b" });

    expect(regionFallback(host, "conversation")).not.toBeNull();
    expect(probe("sidebar")).not.toBeNull();
    expectOnlyCaughtErrorReports(consoleError, 2);
  });

  it("copies a bounded description with the component stack", async () => {
    vi.useFakeTimers();
    const clipboard = recordingClipboard();
    render({ crash: { region: "composer", kind: "throw" }, clipboard });

    await clickAndSettle("composer", "copy-details");

    expect(clipboard.written).toHaveLength(1);
    const details = clipboard.written[0] ?? "";
    expect(details.length).toBeLessThanOrEqual(AGENT_REGION_FAILURE_DETAILS_MAX_CHARS);
    expect(details.split("\n").slice(0, 3)).toEqual([
      "Codevo agent mode: the composer failed to render",
      `Error: ${RAW_FAILURE}`,
      "Component stack:",
    ]);
    expect(details).toMatch(/\n {2}at Exploding\b/);
    expect(details).toMatch(/\n {2}at RegionProbe\b/);
    expect(regionFallbackAction(host, "composer", "copy-details")?.textContent).toBe("Copied");

    act(() => {
      vi.advanceTimersByTime(1_600);
    });
    expect(regionFallbackAction(host, "composer", "copy-details")?.textContent).toBe(
      "Copy details",
    );
    expect(vi.getTimerCount()).toBe(0);
    expectOnlyCaughtErrorReports(consoleError, 1);
  });

  it("reports a clipboard that rejects the write", async () => {
    const clipboard: TextClipboardGateway = {
      canWriteText: () => true,
      writeText: () => Promise.reject(new Error("denied")),
    };
    render({ crash: { region: "sidebar", kind: "throw" }, clipboard });

    await clickAndSettle("sidebar", "copy-details");

    expect(regionFallbackAction(host, "sidebar", "copy-details")?.textContent).toBe(
      "Couldn't copy",
    );
    expectOnlyCaughtErrorReports(consoleError, 1);
  });

  it("reports a clipboard that cannot write without calling it", async () => {
    const writeText = vi.fn<TextClipboardGateway["writeText"]>();
    render({
      crash: { region: "sidebar", kind: "throw" },
      clipboard: { canWriteText: () => false, writeText },
    });

    await clickAndSettle("sidebar", "copy-details");

    expect(writeText).not.toHaveBeenCalled();
    expect(regionFallbackAction(host, "sidebar", "copy-details")?.textContent).toBe(
      "Couldn't copy",
    );
    expectOnlyCaughtErrorReports(consoleError, 1);
  });

  it("omits Copy details when no clipboard is wired", () => {
    render({ crash: { region: "rightPanel", kind: "throw" }, clipboard: null });

    expect(regionFallbackAction(host, "rightPanel", "retry")).not.toBeNull();
    expect(regionFallbackAction(host, "rightPanel", "copy-details")).toBeNull();
    expectOnlyCaughtErrorReports(consoleError, 1);
  });

  it("drops a pending copy result once the region has been retried", async () => {
    let settle: () => void = () => undefined;
    const clipboard: TextClipboardGateway = {
      canWriteText: () => true,
      writeText: () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
    };
    render({ crash: { region: "composer", kind: "throw" }, clipboard });
    click("composer", "copy-details");

    render({ crash: null, clipboard });
    click("composer", "retry");
    await act(async () => settle());

    expect(regionFallback(host, "composer")).toBeNull();
    expect(probe("composer")).not.toBeNull();
    expectOnlyCaughtErrorReports(consoleError, 1);
  });

  it("contains a layout-effect update loop to the region that runs it", async () => {
    const clipboard = recordingClipboard();
    render({ crash: { region: "composer", kind: "updateLoop" }, clipboard });

    expect(regionFallback(host, "composer")?.querySelector("p")?.textContent).toBe(
      "The composer couldn't be displayed",
    );
    expect(host.textContent).not.toContain("Maximum update depth");
    for (const healthy of ["sidebar", "conversation", "rightPanel"] as const) {
      press(healthy);
      expect(probe(healthy)?.textContent).toBe("1");
    }

    await clickAndSettle("composer", "copy-details");
    expect(clipboard.written[0]).toContain("Error: Maximum update depth exceeded.");
    expect(clipboard.written[0]).toMatch(/\n {2}at FreshValueSource\b/);
    expectOnlyCaughtErrorReports(consoleError, 1);
  });

  it("contains an update loop that drives state owned above the region", () => {
    function Shell() {
      const [reports, setReports] = useState<object>({});
      const [presses, setPresses] = useState(0);
      return (
        <main>
          <button data-shell onClick={() => setPresses((current) => current + 1)} type="button">
            {presses}:{Object.keys(reports).length}
          </button>
          <AgentRegionBoundary clipboard={null} region="composer" resetKeys={[]}>
            <FreshValueSource onChange={setReports} />
          </AgentRegionBoundary>
        </main>
      );
    }

    act(() => root.render(<Shell />));

    expect(regionFallback(host, "composer")).not.toBeNull();
    const shell = host.querySelector<HTMLButtonElement>("button[data-shell]");
    expect(shell).not.toBeNull();
    act(() => shell?.click());
    expect(shell?.textContent).toBe("1:0");
    expectOnlyCaughtErrorReports(consoleError, 1);
  });

  it("keeps state owned above the region and resets state owned inside it", () => {
    let broken = false;

    function Region() {
      const [local, setLocal] = useState(0);
      if (broken) return <Exploding />;
      return (
        <button data-local onClick={() => setLocal((current) => current + 1)} type="button">
          {local}
        </button>
      );
    }

    function Shell() {
      const [selected, setSelected] = useState("thread-a");
      return (
        <main>
          <button data-select onClick={() => setSelected("thread-b")} type="button">
            {selected}
          </button>
          <AgentRegionBoundary clipboard={null} region="conversation" resetKeys={[selected]}>
            <Region />
          </AgentRegionBoundary>
        </main>
      );
    }

    act(() => root.render(<Shell />));
    const local = (): HTMLButtonElement | null => host.querySelector("button[data-local]");
    const select = (): HTMLButtonElement | null => host.querySelector("button[data-select]");
    act(() => local()?.click());
    expect(local()?.textContent).toBe("1");

    broken = true;
    act(() => root.render(<Shell />));
    expect(regionFallback(host, "conversation")).not.toBeNull();
    expect(select()?.textContent).toBe("thread-a");

    broken = false;
    act(() => select()?.click());

    expect(regionFallback(host, "conversation")).toBeNull();
    expect(select()?.textContent).toBe("thread-b");
    expect(local()?.textContent).toBe("0");
    expectOnlyCaughtErrorReports(consoleError, 1);
  });

  it("frames the sidebar and side panel fallbacks in their layout slots", () => {
    render({
      crash: { region: "sidebar", kind: "throw" },
      clipboard: null,
    });
    expect(regionFallback(host, "sidebar")?.parentElement?.matches("aside.agent-rail")).toBe(true);

    render({ crash: { region: "rightPanel", kind: "throw" }, clipboard: null });
    const panel = regionFallback(host, "rightPanel")?.closest('[data-slot="surface"]');
    expect(panel?.matches("div.agent-surface-host")).toBe(true);
    expect(panel?.hasAttribute("hidden")).toBe(false);
    expect(panel?.querySelector('.agent-surface[data-editor-slot="none"]')).not.toBeNull();

    render({
      crash: { region: "rightPanel", kind: "throw" },
      clipboard: null,
      rightPanelHidden: true,
    });
    const hiddenPanel = regionFallback(host, "rightPanel")?.closest('[data-slot="surface"]');
    expect(hiddenPanel?.hasAttribute("hidden")).toBe(true);
    expect(hiddenPanel?.getAttribute("aria-hidden")).toBe("true");
    expectOnlyCaughtErrorReports(consoleError, 2);
  });
});
