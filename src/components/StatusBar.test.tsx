// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultStatusBarItemVisibility } from "../domain/settings";
import { StatusBar } from "./StatusBar";

describe("StatusBar", () => {
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

  it("renders IDE engine and index as one activity item", async () => {
    await act(async () => {
      root.render(
        <StatusBar
          activeLanguage="php"
          activePath="/workspace/app/Http/Controllers/CommentController.php"
          dirtyCount={0}
          ideActivityLabel="IDE: PHPactor running · Index 608 files"
          ideActivityState="active"
          intelligenceMode="fullSmart"
          message={null}
          onChangeVisibility={vi.fn()}
          statusBar={defaultStatusBarItemVisibility()}
          workspaceInfoLabel="laravel/laravel · PHP ^8.4"
          workspaceRoot="/workspace"
          workspaceTrustLabel="Trusted"
        />,
      );
    });

    const activity = host.querySelector(".status-ide-activity");

    expect(activity?.textContent).toBe("IDE: PHPactor running · Index 608 files");
    expect(activity?.classList.contains("active")).toBe(true);
    expect(host.textContent).not.toContain("PHPactor: running");
    expect(host.textContent).not.toContain("Index: 608 files");
  });
});
