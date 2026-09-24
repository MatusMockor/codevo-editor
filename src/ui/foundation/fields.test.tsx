// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountUi, type MountedUi } from "./foundationTestSupport";
import { TextArea } from "./TextArea";
import { TextField } from "./TextField";

let ui: MountedUi | null = null;

afterEach(() => {
  ui?.unmount();
  ui = null;
});

function type(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = Object.getPrototypeOf(element) as object;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  act(() => {
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("TextField", () => {
  it("labels the input and describes it with the hint", () => {
    ui = mountUi();
    ui.render(
      <TextField
        hint="Folder name used on disk"
        label="Destination"
        onChange={() => undefined}
        optional
        value="~/code/app"
      />,
    );
    const input = ui.host.querySelector("input") as HTMLInputElement;
    const label = ui.host.querySelector("label");
    const hint = ui.host.querySelector(".cv-field__hint");

    expect(label?.getAttribute("for")).toBe(input.id);
    expect(label?.textContent).toBe("DestinationOptional");
    expect(input.getAttribute("aria-describedby")).toBe(hint?.id);
    expect(hint?.textContent).toBe("Folder name used on disk");
    expect(input.getAttribute("aria-invalid")).toBe("false");
    expect(input.type).toBe("text");
  });

  it("replaces the hint with an alert when the value is invalid", () => {
    ui = mountUi();
    ui.render(
      <TextField
        error="Not a Git URL"
        hint="HTTPS or SSH"
        label="Repository"
        mono
        onChange={() => undefined}
        value="nope"
      />,
    );
    const input = ui.host.querySelector("input") as HTMLInputElement;
    const hint = ui.host.querySelector(".cv-field__hint");

    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.className).toBe("cv-input cv-input--mono");
    expect(hint?.getAttribute("role")).toBe("alert");
    expect(hint?.className).toBe("cv-field__hint cv-field__hint--error");
    expect(hint?.textContent).toBe("Not a Git URL");
  });

  it("reports typed text and omits the description when there is no hint", () => {
    const onChange = vi.fn();
    ui = mountUi();
    ui.render(<TextField label="Branch" onChange={onChange} value="" />);
    const input = ui.host.querySelector("input") as HTMLInputElement;

    type(input, "feature/p1");

    expect(onChange).toHaveBeenCalledWith("feature/p1");
    expect(input.hasAttribute("aria-describedby")).toBe(false);
  });
});

describe("TextArea", () => {
  it("labels the textarea and reports typed text", () => {
    const onChange = vi.fn();
    ui = mountUi();
    ui.render(<TextArea hint="Markdown" label="Description" onChange={onChange} value="" />);
    const area = ui.host.querySelector("textarea") as HTMLTextAreaElement;

    expect(ui.host.querySelector("label")?.getAttribute("for")).toBe(area.id);
    expect(area.className).toBe("cv-textarea");
    type(area, "Adds palettes");
    expect(onChange).toHaveBeenCalledWith("Adds palettes");
  });
});
