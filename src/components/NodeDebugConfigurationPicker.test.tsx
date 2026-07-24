// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { NodeDebugConfigurationPicker } from "./NodeDebugConfigurationPicker";

describe("NodeDebugConfigurationPicker", () => {
  it("adapts the shared picker to the existing Debug copy", () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    act(() =>
      root.render(
        <NodeDebugConfigurationPicker
          busy={false}
          choices={[]}
          error={null}
          onClose={vi.fn()}
          onRefresh={vi.fn()}
          onStartNamed={vi.fn()}
          open
          selectedName={null}
          state="empty"
        />,
      ),
    );

    expect(host.querySelector('[role="dialog"] strong')?.textContent).toBe(
      "Select Node debug configuration",
    );
    expect(host.querySelector('[role="status"]')?.textContent).toBe("No Node debug configurations");
    act(() => root.unmount());
    host.remove();
  });
});
