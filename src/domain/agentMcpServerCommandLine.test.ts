import { describe, expect, it } from "vitest";
import {
  MAX_AGENT_MCP_SERVER_COMMAND_LINE_BYTES,
  parseAgentMcpServerCommandLine,
} from "./agentMcpServerCommandLine";

function words(input: string): ReadonlyArray<string> | string {
  const line = parseAgentMcpServerCommandLine(input);
  return line.kind === "parsed" ? [line.command, ...line.args] : line.issue;
}

describe("parseAgentMcpServerCommandLine", () => {
  it.each([
    ["npx", ["npx"]],
    ["npx -y @scope/server", ["npx", "-y", "@scope/server"]],
    ["  npx \t -y   server  ", ["npx", "-y", "server"]],
    ["node 'my server.js' --root '/tmp/a b'", ["node", "my server.js", "--root", "/tmp/a b"]],
    ['node "my server.js" --name "it\'s"', ["node", "my server.js", "--name", "it's"]],
    ["node my\\ server.js", ["node", "my server.js"]],
    ["'/opt/My Tools/server' run", ["/opt/My Tools/server", "run"]],
    ["server --flag=''", ["server", "--flag="]],
    ["server '' \"\"", ["server", "", ""]],
    ["server a'b c'\"d e\"f", ["server", "ab cd ef"]],
    ['server "a \\"quoted\\" word"', ["server", 'a "quoted" word']],
    [
      'server "back\\\\slash" "keep\\n" "\\$HOME" "\\`x\\`"',
      ["server", "back\\slash", "keep\\n", "$HOME", "`x`"],
    ],
    ["server 'single \\ stays' \\'", ["server", "single \\ stays", "'"]],
    ['server \\\\ \\"', ["server", "\\", '"']],
    ["sérver ünïcode 日本語 🙂", ["sérver", "ünïcode", "日本語", "🙂"]],
    ["server \\🙂x", ["server", "🙂x"]],
  ])("splits %j", (input, expected) => {
    expect(words(input)).toEqual(expected);
  });

  it.each([
    [
      "server $HOME ${VAR:-x} $(whoami) `id`",
      ["server", "$HOME", "${VAR:-x}", "$(whoami)", "`id`"],
    ],
    ["server *.js ? [a-z] {a,b} ~", ["server", "*.js", "?", "[a-z]", "{a,b}", "~"]],
    [
      "server a | b && c || d ; e & f",
      ["server", "a", "|", "b", "&&", "c", "||", "d", ";", "e", "&", "f"],
    ],
    ["server > out.txt 2>&1 < in.txt", ["server", ">", "out.txt", "2>&1", "<", "in.txt"]],
    ["server a;rm -rf /", ["server", "a;rm", "-rf", "/"]],
    ["server #not a comment", ["server", "#not", "a", "comment"]],
    ["FOO=bar server", ["FOO=bar", "server"]],
    ['server !! "!$"', ["server", "!!", "!$"]],
  ])("never expands or interprets %j", (input, expected) => {
    expect(words(input)).toEqual(expected);
  });

  it.each([
    ["", "empty"],
    ["   \t ", "empty"],
    ["''", "empty"],
    ['"" arg', "empty"],
    ["server 'open", "unbalancedQuote"],
    ['server "open', "unbalancedQuote"],
    ['server "ends with escape\\', "unbalancedQuote"],
    ['server "escaped quote\\"', "unbalancedQuote"],
    ["server it's", "unbalancedQuote"],
    ["server \\", "danglingEscape"],
    ["\\", "danglingEscape"],
    ["server a\nb", "controlCharacter"],
    ["server\nrm -rf /", "controlCharacter"],
    ["server 'a\tb'", "controlCharacter"],
    ["server a\u0000b", "controlCharacter"],
    ["server \\\n", "controlCharacter"],
    ["server a\r", "controlCharacter"],
    ["server \u001b[31m", "controlCharacter"],
  ])("fails closed for %j with %s", (input, issue) => {
    expect(words(input)).toBe(issue);
  });

  it("enforces the command, argument, and argument count limits", () => {
    const maxArgs = Array<string>(32).fill("a");
    expect(words(["server", ...maxArgs].join(" "))).toEqual(["server", ...maxArgs]);
    expect(words(["server", ...maxArgs, "one-too-many"].join(" "))).toBe("tooManyArguments");
    expect(words(`${"c".repeat(1024)} arg`)).toEqual(["c".repeat(1024), "arg"]);
    expect(words(`${"c".repeat(1025)} arg`)).toBe("commandTooLong");
    expect(words(`${"é".repeat(513)} arg`)).toBe("commandTooLong");
    expect(words(`server ${"a".repeat(1024)}`)).toEqual(["server", "a".repeat(1024)]);
    expect(words(`server ${"a".repeat(1025)}`)).toBe("argumentTooLong");
    expect(words(`server '${"é".repeat(513)}'`)).toBe("argumentTooLong");
  });

  it("bounds the whole line before splitting it", () => {
    const filler = " a".repeat(MAX_AGENT_MCP_SERVER_COMMAND_LINE_BYTES);
    expect(words(`server${filler}`)).toBe("tooLong");
    expect(words("a ".repeat(40))).toBe("tooManyArguments");
    expect(words(`server ${"🙂".repeat(MAX_AGENT_MCP_SERVER_COMMAND_LINE_BYTES / 4)}`)).toBe(
      "tooLong",
    );
  });

  it("returns frozen results", () => {
    const line = parseAgentMcpServerCommandLine("server a b");
    expect(Object.isFrozen(line)).toBe(true);
    expect(line.kind === "parsed" && Object.isFrozen(line.args)).toBe(true);
    expect(Object.isFrozen(parseAgentMcpServerCommandLine("'"))).toBe(true);
  });
});
