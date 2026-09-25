// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import type { DebugExceptionPauseMode } from "../../domain/debug";
import { click, mountUi, press, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import { DebugSectionsRegion } from "./DebugSectionsRegion";
import { debugPanelTestProps } from "./debugPanelTestProps";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let mounted: MountedUi | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

function rows(host: HTMLElement): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>('[role="checkbox"].cv-dside__bp')];
}

describe("DebugSectionsRegion", () => {
  it("renders Variables, Watch, Call stack and Breakpoints as collapsible sections in that order", () => {
    mounted = mountUi();
    mounted.render(<DebugSectionsRegion {...debugPanelTestProps()} />);
    const aside = mounted.host.querySelector('aside.cv-dside[aria-label="Debug"]');
    const headers = [...mounted.host.querySelectorAll<HTMLElement>(".cv-dside__head")];

    expect(aside).not.toBeNull();
    expect(headers.map((header) => header.firstChild?.nextSibling?.textContent)).toEqual([
      "Variables",
      "Watch",
      "Call stack",
      "Breakpoints",
    ]);
    expect(mounted.host.querySelector('section[aria-label="Variables"]')?.textContent).toContain(
      "Not paused",
    );
    click(headers[0] as Element);
    expect(headers[0]?.getAttribute("aria-expanded")).toBe("false");
    expect(
      mounted.host.querySelector('section[aria-label="Variables"]')?.textContent,
    ).not.toContain("Not paused");
  });

  it.each([
    ["none", [false, false], [false, false]],
    ["uncaught", [false, true], [false, false]],
    ["all", [true, true], [false, true]],
  ] as const)("shows %s as exact exception rows", (mode, checked, implied) => {
    mounted = mountUi();
    mounted.render(<DebugSectionsRegion {...debugPanelTestProps({ exceptionPauseMode: mode })} />);

    expect(rows(mounted.host).map((row) => row.getAttribute("aria-label"))).toEqual([
      "All exceptions",
      "Uncaught exceptions",
    ]);
    expect(rows(mounted.host).map((row) => row.getAttribute("aria-checked") === "true")).toEqual(
      checked,
    );
    expect(rows(mounted.host).map((row) => row.dataset.implied === "true")).toEqual(implied);
  });

  it.each([
    ["none", "All exceptions", "all"],
    ["none", "Uncaught exceptions", "uncaught"],
    ["uncaught", "Uncaught exceptions", "none"],
    ["uncaught", "All exceptions", "all"],
    ["all", "All exceptions", "uncaught"],
    ["all", "Uncaught exceptions", "none"],
  ] as const)(
    "maps %s + %s to %s",
    (mode: DebugExceptionPauseMode, label: string, expected: DebugExceptionPauseMode) => {
      const props = debugPanelTestProps({ exceptionPauseMode: mode });
      mounted = mountUi();
      mounted.render(<DebugSectionsRegion {...props} />);
      click(mounted.host.querySelector(`[role="checkbox"][aria-label="${label}"]`) as Element);

      expect(props.onSetExceptionPauseMode).toHaveBeenCalledExactlyOnceWith(expected);
    },
  );

  it("toggles an exception row from the keyboard", () => {
    const props = debugPanelTestProps({ exceptionPauseMode: "none" });
    mounted = mountUi();
    mounted.render(<DebugSectionsRegion {...props} />);
    press(mounted.host.querySelector('[aria-label="Uncaught exceptions"]') as Element, " ");

    expect(props.onSetExceptionPauseMode).toHaveBeenCalledExactlyOnceWith("uncaught");
  });

  it("never sends an exception request while a change is pending or the workspace is untrusted", () => {
    for (const overrides of [{ exceptionPausePending: true }, { workspaceTrusted: false }]) {
      const props = debugPanelTestProps({ exceptionPauseMode: "uncaught", ...overrides });
      mounted?.unmount();
      mounted = mountUi();
      mounted.render(<DebugSectionsRegion {...props} />);
      for (const row of rows(mounted.host)) {
        expect(row.getAttribute("aria-disabled")).toBe("true");
        click(row);
        press(row, " ");
      }

      expect(props.onSetExceptionPauseMode).not.toHaveBeenCalled();
    }
  });

  it("reports an exception policy error as an alert", () => {
    mounted = mountUi();
    mounted.render(
      <DebugSectionsRegion {...debugPanelTestProps({ exceptionPauseError: "Rejected" })} />,
    );

    expect(mounted.host.querySelector('[role="alert"]')?.textContent).toBe("Rejected");
  });
});
