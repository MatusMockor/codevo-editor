import { describe, expect, it } from "vitest";
import {
  TerminalShellIntegrationRegistry,
  TerminalShellIntegrationScanner,
  terminalShellIntegrationBufferLimit,
} from "./terminalShellIntegration";

const bel = "\u0007";
const st = "\u001b\\";

describe("TerminalShellIntegrationScanner", () => {
  it.each([
    ["\u001b]133;A", { kind: "promptStart" }],
    ["\u001b]133;B", { kind: "commandStart" }],
    ["\u001b]133;C", { kind: "preExec" }],
    ["\u001b]133;D;17", { exitCode: 17, kind: "commandEnd" }],
    ["\u001b]7;file://host/workspace/src", { cwd: "/workspace/src", kind: "cwd" }],
  ])("parses %s with BEL and ST terminators", (sequence, event) => {
    for (const terminator of [bel, st]) {
      const scanner = new TerminalShellIntegrationScanner();

      expect(scanner.feed(`${sequence}${terminator}`).events).toEqual([event]);
    }
  });

  it("parses every split boundary without changing the source chunks", () => {
    const sequence = "\u001b]133;D;23\u001b\\";

    for (let split = 0; split <= sequence.length; split += 1) {
      const scanner = new TerminalShellIntegrationScanner();
      const first = sequence.slice(0, split);
      const second = sequence.slice(split);

      const events = [
        ...scanner.feed(first).events,
        ...scanner.feed(second).events,
      ];

      expect(events).toEqual([
        { exitCode: 23, kind: "commandEnd" },
      ]);
      expect(first + second).toBe(sequence);
    }
  });

  it("finds shell events interleaved with colored terminal output", () => {
    const scanner = new TerminalShellIntegrationScanner();
    const chunk = `\u001b[31mred\u001b[0m\u001b]133;A${bel}\u001b[32mgreen\u001b[0m`;

    expect(scanner.feed(chunk).events).toEqual([{ kind: "promptStart" }]);
    expect(chunk).toContain("\u001b[31mred\u001b[0m");
  });

  it.each([
    ["/workspace/with%20space", "/workspace/with space"],
    ["/workspace/with%25percent", "/workspace/with%percent"],
    ["/workspace/%C5%BElut%C3%BD", "/workspace/žlutý"],
    ["/workspace/it%27s", "/workspace/it's"],
  ])("decodes percent-encoded cwd %s", (encodedPath, cwd) => {
    const scanner = new TerminalShellIntegrationScanner();

    expect(
      scanner.feed(`\u001b]7;file://host${encodedPath}${bel}`).events,
    ).toEqual([{ cwd, kind: "cwd" }]);
  });

  it.each(["", "nope", "1.5", "-1"])(
    "reports malformed exit code %j as unknown",
    (exitCode) => {
      const scanner = new TerminalShellIntegrationScanner();

      expect(scanner.feed(`\u001b]133;D;${exitCode}${bel}`).events).toEqual([
        { exitCode: null, kind: "commandEnd" },
      ]);
    },
  );

  it("bounds and abandons an unterminated OSC before recovering", () => {
    const scanner = new TerminalShellIntegrationScanner();

    expect(
      scanner.feed(`\u001b]7;${"x".repeat(terminalShellIntegrationBufferLimit + 1)}`)
        .events,
    ).toEqual([]);
    expect(scanner.feed(`\u001b]133;B${bel}`).events).toEqual([
      { kind: "commandStart" },
    ]);
  });
});

describe("TerminalShellIntegrationRegistry", () => {
  it("tracks cwd per session and workspace root", () => {
    const registry = new TerminalShellIntegrationRegistry();

    registry.feed("/one", 1, `\u001b]7;file://host/one/a${bel}`);
    registry.feed("/one", 2, `\u001b]7;file://host/one/b${bel}`);
    registry.feed("/two", 1, `\u001b]7;file://host/two/a${bel}`);

    expect(registry.cwd("/one", 1)).toBe("/one/a");
    expect(registry.cwd("/one", 2)).toBe("/one/b");
    expect(registry.cwd("/two", 1)).toBe("/two/a");
  });

  it("resets cwd when a session exits without affecting other roots", () => {
    const registry = new TerminalShellIntegrationRegistry();

    registry.feed("/one", 1, `\u001b]7;file://host/one${bel}`);
    registry.feed("/two", 1, `\u001b]7;file://host/two${bel}`);
    registry.reset("/one", 1);

    expect(registry.cwd("/one", 1)).toBeNull();
    expect(registry.cwd("/two", 1)).toBe("/two");
  });
});
