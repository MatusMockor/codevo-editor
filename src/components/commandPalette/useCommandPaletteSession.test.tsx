// @vitest-environment jsdom

import { act, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { createCommandPaletteLaunch } from "../../application/commandPalette/commandPaletteLaunch";
import { mountUi, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import { useCommandPaletteSession, type CommandPaletteSession } from "./useCommandPaletteSession";

let ui: MountedUi | null = null;
let session: CommandPaletteSession | null = null;
let flags: {
  palette: boolean;
  quick: boolean;
  setPalette(open: boolean): void;
  setQuick(open: boolean): void;
} | null = null;
const launch = createCommandPaletteLaunch();

function Harness({ initialQuery }: { initialQuery: string }) {
  const [palette, setPalette] = useState(false);
  const [quick, setQuick] = useState(false);
  flags = { palette, quick, setPalette, setQuick };
  session = useCommandPaletteSession({
    paletteOpen: palette,
    quickOpenOpen: quick,
    initialQuery,
    setPaletteOpen: setPalette,
    setQuickOpenOpen: setQuick,
    launch,
  });
  return null;
}

afterEach(() => {
  ui?.unmount();
  ui = null;
  session = null;
  flags = null;
});

describe("useCommandPaletteSession", () => {
  it("opens the root in actions mode for legacy commands.show and the > handoff", () => {
    ui = mountUi();
    ui.render(<Harness initialQuery="tog" />);
    act(() => flags?.setPalette(true));
    expect(session?.page).toBe("root");
    expect(session?.query).toBe(">tog");
  });

  it("honours an explicit launch request", () => {
    ui = mountUi();
    ui.render(<Harness initialQuery="" />);
    act(() => {
      launch.request({ page: "shortcuts", query: "" });
      flags?.setPalette(true);
    });
    expect(session?.page).toBe("shortcuts");
    expect(session?.canGoBack).toBe(true);
  });

  it("opens the files page alone for Cmd+P and switches flags when pushing and popping files", () => {
    ui = mountUi();
    ui.render(<Harness initialQuery="" />);
    act(() => flags?.setQuick(true));
    expect(session?.page).toBe("files");
    expect(session?.canGoBack).toBe(false);

    act(() => session?.close());
    act(() => {
      launch.request({ page: "root", query: "" });
      flags?.setPalette(true);
    });
    act(() => session?.push("files"));
    expect(flags?.palette).toBe(false);
    expect(flags?.quick).toBe(true);
    expect(session?.page).toBe("files");
    expect(session?.canGoBack).toBe(true);

    act(() => session?.pop());
    expect(flags?.palette).toBe(true);
    expect(flags?.quick).toBe(false);
    expect(session?.page).toBe("root");
  });

  it("replaces the page when a launch request arrives while open", () => {
    ui = mountUi();
    ui.render(<Harness initialQuery="" />);
    act(() => {
      launch.request({ page: "root", query: "" });
      flags?.setPalette(true);
    });
    act(() => launch.request({ page: "shortcuts", query: "" }));
    expect(session?.page).toBe("shortcuts");
  });

  it("does not swallow the next real open after a same-surface launch while open", () => {
    ui = mountUi();
    ui.render(<Harness initialQuery="" />);
    act(() => {
      launch.request({ page: "root", query: "" });
      flags?.setPalette(true);
    });
    act(() => launch.request({ page: "shortcuts", query: "" }));
    act(() => session?.close());
    act(() => {
      launch.request({ page: "root", query: "" });
      flags?.setPalette(true);
    });
    expect(session?.page).toBe("root");
    expect(session?.query).toBe("");
  });

  it("opens the root in actions mode when Quick Open hands a > prefix to the palette", () => {
    ui = mountUi();
    ui.render(<Harness initialQuery="tog" />);
    act(() => flags?.setQuick(true));
    act(() => {
      flags?.setQuick(false);
      flags?.setPalette(true);
    });
    expect(session?.page).toBe("root");
    expect(session?.query).toBe(">tog");
    expect(session?.canGoBack).toBe(false);
  });

  it("closes both flags", () => {
    ui = mountUi();
    ui.render(<Harness initialQuery="" />);
    act(() => flags?.setPalette(true));
    act(() => session?.close());
    expect(flags?.palette).toBe(false);
    expect(flags?.quick).toBe(false);
    expect(session?.visible).toBe(false);
  });
});
