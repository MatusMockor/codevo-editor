import { describe, expect, it, vi } from "vitest";
import { registerMonacoAppThemes } from "./monacoThemes";

describe("registerMonacoAppThemes", () => {
  it("registers custom editor themes", () => {
    const defineTheme = vi.fn();

    registerMonacoAppThemes({
      editor: {
        defineTheme,
      },
    } as never);

    expect(defineTheme).toHaveBeenCalledWith(
      "mockor-ayu-mirage",
      expect.objectContaining({ base: "vs-dark" }),
    );
    expect(defineTheme).toHaveBeenCalledWith(
      "mockor-material-deep-ocean",
      expect.objectContaining({ base: "vs-dark" }),
    );
  });
});
