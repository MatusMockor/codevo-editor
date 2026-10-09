import { describe, expect, it } from "vitest";
import {
  AGENT_REGION_FAILURE_DETAILS_MAX_CHARS,
  agentRegionFailureDetails,
  agentRegionFailureTitle,
  type AgentRegion,
} from "./agentRegionFailurePresentation";

const REGIONS: ReadonlyArray<AgentRegion> = ["sidebar", "conversation", "composer", "rightPanel"];
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const REACT_185 =
  "Minified React error #185; visit https://react.dev/errors/185 for the full message or use the non-minified dev environment for full errors and additional helpful warnings.";

describe("agentRegionFailureTitle", () => {
  it("names each region in plain words", () => {
    expect(REGIONS.map(agentRegionFailureTitle)).toEqual([
      "The sidebar couldn't be displayed",
      "The conversation couldn't be displayed",
      "The composer couldn't be displayed",
      "The side panel couldn't be displayed",
    ]);
  });

  it("never carries the raw error text", () => {
    for (const region of REGIONS) {
      expect(agentRegionFailureTitle(region)).not.toMatch(/react|error|#\d+|https?:/i);
    }
  });
});

describe("agentRegionFailureDetails", () => {
  it("describes the region, the error and the component stack", () => {
    const details = agentRegionFailureDetails({
      region: "composer",
      error: new Error(REACT_185),
      componentStack: "\n    at AgentComposer (app.js:1:2)\n    at AgentComposerController",
    });

    expect(details.split("\n")).toEqual([
      "Codevo agent mode: the composer failed to render",
      `Error: ${REACT_185}`,
      "Component stack:",
      "  at AgentComposer (app.js:1:2)",
      "  at AgentComposerController",
    ]);
  });

  it("keeps the error subclass name", () => {
    const details = agentRegionFailureDetails({
      region: "sidebar",
      error: new TypeError("rows is not iterable"),
      componentStack: null,
    });

    expect(details.split("\n")).toEqual([
      "Codevo agent mode: the sidebar failed to render",
      "TypeError: rows is not iterable",
      "Component stack:",
      "  Component stack unavailable.",
    ]);
  });

  it("reports thrown non-error values without serialising them", () => {
    const thrownText = agentRegionFailureDetails({
      region: "conversation",
      error: "plain text failure",
      componentStack: "",
    });
    const thrownObject = agentRegionFailureDetails({
      region: "conversation",
      error: { token: "do-not-copy" },
      componentStack: "   \n  ",
    });

    expect(thrownText).toContain("Error: plain text failure");
    expect(thrownText).toContain("  Component stack unavailable.");
    expect(thrownObject).toContain("Error: No error message was reported.");
    expect(thrownObject).not.toContain("do-not-copy");
  });

  it("flattens multi-line and control characters in the message to one line", () => {
    const details = agentRegionFailureDetails({
      region: "rightPanel",
      error: new Error("first line\n\tsecond\u0000line‮with separators"),
      componentStack: null,
    });

    expect(details.split("\n")[1]).toBe("Error: first line second line with separators");
  });

  it("marks a truncated message instead of copying it whole", () => {
    const details = agentRegionFailureDetails({
      region: "composer",
      error: new Error("x".repeat(50_000)),
      componentStack: null,
    });
    const messageLine = details.split("\n")[1] ?? "";

    expect(messageLine.endsWith("… [truncated]")).toBe(true);
    expect(messageLine.length).toBeLessThanOrEqual("Error: ".length + 500);
  });

  it("does not split a surrogate pair at the truncation edge", () => {
    const details = agentRegionFailureDetails({
      region: "composer",
      error: new Error("😀".repeat(2_000)),
      componentStack: null,
    });
    const messageLine = details.split("\n")[1] ?? "";

    expect(messageLine.endsWith("… [truncated]")).toBe(true);
    expect(messageLine).not.toMatch(LONE_SURROGATE);
  });

  it("keeps the innermost frames and states that the rest were omitted", () => {
    const frames = Array.from({ length: 400 }, (_, index) => `    at Component${index}`);
    const details = agentRegionFailureDetails({
      region: "conversation",
      error: new Error("deep tree"),
      componentStack: `\n${frames.join("\n")}`,
    });
    const stack = details.split("\n").slice(3);

    expect(stack).toHaveLength(21);
    expect(stack[0]).toBe("  at Component0");
    expect(stack[19]).toBe("  at Component19");
    expect(stack[20]).toBe("  … [further frames omitted]");
  });

  it("stays within the bound for adversarial input", () => {
    const hostile = `${"\u0007".repeat(10_000)}${"y".repeat(1_000_000)}`;
    const error = new Error(hostile);
    error.name = "N".repeat(10_000);
    const details = agentRegionFailureDetails({
      region: "rightPanel",
      error,
      componentStack: Array.from({ length: 5_000 }, () => `    at ${"Z".repeat(5_000)}`).join("\n"),
    });

    expect(details.length).toBeLessThanOrEqual(AGENT_REGION_FAILURE_DETAILS_MAX_CHARS);
    expect(details.split("\n").every((line) => line.length <= 600)).toBe(true);
    expect(details).toContain("… [truncated]");
    expect(details).toContain("… [further frames omitted]");
  });
});
