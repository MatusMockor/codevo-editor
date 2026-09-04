import { describe, expect, it } from "vitest";
import { agentPickerOption } from "./agentPickerOption";

describe("agentPickerOption", () => {
  it("keeps a bare option neutral and free of description and detail", () => {
    expect(agentPickerOption("all", "All")).toEqual({
      value: "all",
      label: "All",
      description: null,
      tone: null,
      detail: null,
      icon: null,
    });
  });

  it("carries the description, tone and detail it is given", () => {
    const option = agentPickerOption("bypass", "Bypass", "Skips every check.", "danger", 4);

    expect(option.description).toBe("Skips every check.");
    expect(option.tone).toBe("danger");
    expect(option.detail).toBe(4);
  });

  it("builds a distinct option for every value", () => {
    const options = ["a", "b"].map((value) => agentPickerOption(value, value.toUpperCase()));

    expect(options.map((option) => option.value)).toEqual(["a", "b"]);
    expect(options.map((option) => option.label)).toEqual(["A", "B"]);
  });
});
