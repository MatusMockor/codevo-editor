import { describe, expect, it } from "vitest";
import { MAX_AGENT_TOOL_SUMMARY_BYTES } from "./agentThread";
import {
  MAX_AGENT_TOOL_ROW_SUBJECT_CHARS,
  commandProgramName,
  toolRowKind,
  toolRowLabel,
  type AgentToolRowKind,
  type AgentToolRowStatus,
} from "./agentToolRowPresentation";

const ROOT = "/Users/dev/projects/editor";

function label(
  name: string,
  inputSummary: string,
  status: AgentToolRowStatus = "ok",
  extra: { readonly description?: string; readonly workspaceRoot?: string | null } = {},
) {
  return toolRowLabel({ name, inputSummary, status, ...extra });
}

describe("toolRowKind", () => {
  it("maps the known tool families", () => {
    const expected: ReadonlyArray<readonly [string, AgentToolRowKind]> = [
      ["Bash", "command"],
      ["Read", "read"],
      ["NotebookRead", "read"],
      ["Edit", "edit"],
      ["MultiEdit", "edit"],
      ["Write", "edit"],
      ["apply_patch", "edit"],
      ["Grep", "search"],
      ["Glob", "search"],
      ["Task", "agent"],
      ["Agent", "agent"],
      ["spawn_agent", "agent"],
      ["WebFetch", "web"],
      ["WebSearch", "web"],
    ];
    for (const [name, kind] of expected) expect(toolRowKind(name), name).toBe(kind);
  });

  it("matches case-insensitively and trims surrounding space", () => {
    expect(toolRowKind("bash")).toBe("command");
    expect(toolRowKind("  READ  ")).toBe("read");
  });

  it("falls back to other for unknown and namespaced tools", () => {
    expect(toolRowKind("mcp__linear__get_issue")).toBe("other");
    expect(toolRowKind("")).toBe("other");
    expect(toolRowKind("TodoWrite")).toBe("other");
  });
});

describe("commandProgramName", () => {
  it("returns null when there is no program", () => {
    expect(commandProgramName("")).toBeNull();
    expect(commandProgramName("   ")).toBeNull();
    expect(commandProgramName("|| && ;")).toBeNull();
  });

  it("takes the first program of a simple command", () => {
    expect(commandProgramName("grep -rn needle src")).toBe("grep");
  });

  it("reduces an absolute program path to its basename", () => {
    expect(commandProgramName("/usr/local/bin/node script.js")).toBe("node");
    expect(commandProgramName("./scripts/build.sh --watch")).toBe("build.sh");
  });

  it("skips leading directory changes joined by && and ;", () => {
    expect(commandProgramName("cd /tmp && ls -la")).toBe("ls");
    expect(commandProgramName("cd src; cargo test")).toBe("cargo");
    expect(commandProgramName("pushd /tmp && popd && git status")).toBe("git");
  });

  it("skips environment assignments and privilege prefixes", () => {
    expect(commandProgramName("FOO=bar BAZ=qux ./run.sh")).toBe("run.sh");
    expect(commandProgramName("sudo -E systemctl restart nginx")).toBe("systemctl");
    expect(commandProgramName("env NODE_ENV=test vitest")).toBe("vitest");
    expect(commandProgramName("command -v rg")).toBe("rg");
  });

  it("keeps the runner and the script for package runners", () => {
    expect(commandProgramName("npm run lint -- --max-warnings 0")).toBe("npm run lint");
    expect(commandProgramName("npm test")).toBe("npm test");
    expect(commandProgramName("npm")).toBe("npm");
    expect(commandProgramName("npm run")).toBe("npm run");
    expect(commandProgramName("npx vitest run src/foo.test.ts")).toBe("npx vitest");
    expect(commandProgramName("pnpm build")).toBe("pnpm build");
    expect(commandProgramName("yarn run test:unit")).toBe("yarn run test:unit");
  });

  it("skips shell keywords, builtins and sourcing prefixes", () => {
    expect(commandProgramName("if grep -q needle file; then echo yes; fi")).toBe("grep");
    expect(commandProgramName("while read line; do echo $line; done")).toBe("read");
    expect(commandProgramName("eval npm test")).toBe("npm test");
    expect(commandProgramName("exec ./server.js")).toBe("server.js");
    expect(commandProgramName("source ./env.sh && npm test")).toBe("env.sh");
    expect(commandProgramName(". ./env.sh && npm test")).toBe("env.sh");
    expect(commandProgramName("export PATH=/x && cargo test")).toBe("cargo");
  });

  it("skips the value of a value-taking prefix flag", () => {
    expect(commandProgramName("sudo -u postgres psql -c 'select 1'")).toBe("psql");
    expect(commandProgramName("env -u NODE_ENV vitest run")).toBe("vitest");
    expect(commandProgramName("time -f %e npm test")).toBe("npm test");
    expect(commandProgramName("sudo --user=deploy systemctl restart web")).toBe("systemctl");
  });

  it("skips a timeout budget, a variable reference and a runner path flag", () => {
    expect(commandProgramName("timeout 30 npm test")).toBe("npm test");
    expect(commandProgramName("timeout 1.5s cargo build")).toBe("cargo");
    expect(commandProgramName("${NODE} server.js")).toBe("server.js");
    expect(commandProgramName("$HOME/bin/rg pattern")).toBe("rg");
    expect(commandProgramName("npm --prefix packages/api run build")).toBe("npm run build");
    expect(commandProgramName("pnpm -C apps/web test")).toBe("pnpm test");
  });

  it("labels a word-taking shell keyword as the shell itself", () => {
    expect(commandProgramName("for f in *.ts; do echo $f; done")).toBe("shell");
    expect(commandProgramName("case $mode in start) npm start;; esac")).toBe("shell");
  });

  it("skips leading redirections and never reports a file descriptor as a program", () => {
    expect(commandProgramName("> out.txt npm test")).toBe("npm test");
    expect(commandProgramName(">out.txt npm test")).toBe("npm test");
    expect(commandProgramName("< input.txt sort")).toBe("sort");
    expect(commandProgramName("2>&1 npm test")).toBe("npm test");
    expect(commandProgramName(">> log.txt cargo build")).toBe("cargo");
    expect(commandProgramName("2> err.log")).toBeNull();
  });

  it("keeps a backslash that does not escape a shell metacharacter", () => {
    expect(commandProgramName("C:\\tools\\rg.exe --files")).toBe("rg.exe");
    expect(commandProgramName('"C:\\Program Files\\nodejs\\node.exe" app.js')).toBe("node.exe");
    expect(commandProgramName("echo \\$HOME")).toBe("echo");
  });

  it("takes the first meaningful program across pipes and conjunctions", () => {
    expect(commandProgramName("rg --files | head -20")).toBe("rg");
    expect(commandProgramName("make check && npm run lint")).toBe("make");
    expect(commandProgramName("cd app && npm run build | tee out.log")).toBe("npm run build");
  });

  it("looks inside a leading subshell", () => {
    expect(commandProgramName("(cd src && cargo fmt)")).toBe("cargo");
    expect(commandProgramName("$(which node) --version")).toBe("which");
  });

  it("handles quoting without leaking the quote characters", () => {
    expect(commandProgramName(`"/opt/my tools/bin/rg" pattern`)).toBe("rg");
    expect(commandProgramName(`sh -c 'npm test'`)).toBe("sh");
    expect(commandProgramName(`git commit -m "cd /tmp && rm -rf /"`)).toBe("git");
    expect(commandProgramName(`grep 'a"b' file`)).toBe("grep");
  });

  it("treats redirections as token breaks rather than programs", () => {
    expect(commandProgramName("tsc --noEmit > out.txt 2>&1")).toBe("tsc");
  });

  it("gives up after four segments of directory changes", () => {
    expect(commandProgramName("cd a && cd b && cd c && cd d && ls")).toBeNull();
    expect(commandProgramName("cd a && cd b && cd c && ls")).toBe("ls");
  });

  it("stays bounded and fast on adversarial input", () => {
    const long = `${"a".repeat(100_000)} ${"b".repeat(100_000)}`;
    const started = Date.now();
    const program = commandProgramName(long);
    expect(program).not.toBeNull();
    expect((program ?? "").length).toBeLessThanOrEqual(MAX_AGENT_TOOL_ROW_SUBJECT_CHARS);
    expect(commandProgramName("&& ".repeat(50_000))).toBeNull();
    expect(commandProgramName(`"${"x".repeat(200_000)}`)).not.toBeNull();
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("keeps unicode programs and arguments intact", () => {
    expect(commandProgramName("./skript-č.sh --režim")).toBe("skript-č.sh");
    expect(commandProgramName("cd /tmp/ľuboš && rg 日本語")).toBe("rg");
  });
});

describe("toolRowLabel", () => {
  it("phrases commands by status", () => {
    expect(label("Bash", "grep -rn needle src", "running")).toEqual({
      verb: "Running",
      subject: "grep",
      argument: "grep -rn needle src",
    });
    expect(label("Bash", "grep -rn needle src", "ok").verb).toBe("Ran");
    expect(label("Bash", "grep -rn needle src", "error").verb).toBe("Failed");
  });

  it("phrases reads, edits, searches, delegations, fetches and unknown tools", () => {
    expect(label("Read", "/tmp/a/b.ts", "running").verb).toBe("Reading");
    expect(label("Read", "/tmp/a/b.ts").verb).toBe("Read");
    expect(label("Edit", "/tmp/a/b.ts", "running").verb).toBe("Editing");
    expect(label("Edit", "/tmp/a/b.ts").verb).toBe("Edited");
    expect(label("Grep", "needle", "running").verb).toBe("Searching");
    expect(label("Grep", "needle").verb).toBe("Searched");
    expect(label("Task", "Audit the rail", "running").verb).toBe("Delegating");
    expect(label("Task", "Audit the rail").verb).toBe("Delegated");
    expect(label("WebFetch", "https://example.com", "running").verb).toBe("Fetching");
    expect(label("WebFetch", "https://example.com").verb).toBe("Fetched");
    expect(label("TodoWrite", "", "running").verb).toBe("Calling");
    expect(label("TodoWrite", "").verb).toBe("Called");
  });

  it("drops the verb when a Claude bash description already reads as a sentence", () => {
    for (const status of ["running", "ok", "error"] as ReadonlyArray<AgentToolRowStatus>) {
      expect(
        label("Bash", "npm run lint -- --max-warnings 0", status, {
          description: "Run the linter",
        }),
        status,
      ).toEqual({
        verb: "",
        subject: "Run the linter",
        argument: "npm run lint -- --max-warnings 0",
      });
    }
  });

  it("keeps the verb for a delegation description and for a command without one", () => {
    expect(label("Task", "Audit the rail", "ok", { description: "Audit the rail" })).toEqual({
      verb: "Delegated",
      subject: "Audit the rail",
      argument: null,
    });
    expect(label("Bash", "npm run lint", "ok").verb).toBe("Ran");
  });

  it("shows the first path of a Codex apply_patch list and counts the rest", () => {
    expect(
      label("apply_patch", `${ROOT}/src/a.ts, ${ROOT}/src/b.ts`, "ok", { workspaceRoot: ROOT })
        .subject,
    ).toBe("src/a.ts +1 more");
    expect(
      label("apply_patch", `${ROOT}/src/a.ts, ${ROOT}/b.ts, ${ROOT}/c.ts`, "ok", {
        workspaceRoot: ROOT,
      }).subject,
    ).toBe("src/a.ts +2 more");
    expect(label("apply_patch", `${ROOT}/src/a.ts`, "ok", { workspaceRoot: ROOT }).subject).toBe(
      "src/a.ts",
    );
  });

  it("phrases an unresolved call on a stopped turn without animation wording", () => {
    expect(label("Bash", "npm test", "stopped")).toEqual({
      verb: "Stopped",
      subject: "npm test",
      argument: null,
    });
    expect(label("Read", "/tmp/a/b.ts", "stopped").verb).toBe("Stopped");
  });

  it("clips a long description to a single bounded sentence", () => {
    const description = `Run ${"very ".repeat(60)}long linter`;
    const clipped = label("Bash", "npm run lint", "ok", { description }).subject;
    expect([...clipped]).toHaveLength(MAX_AGENT_TOOL_ROW_SUBJECT_CHARS);
    expect(clipped.endsWith("\u2026")).toBe(true);
    expect(clipped).not.toContain("\n");
  });

  it("shows file paths workspace-relative when they sit under the root", () => {
    expect(
      label("Read", `${ROOT}/src/components/agentMode/AgentThreadSession.tsx`, "ok", {
        workspaceRoot: ROOT,
      }).subject,
    ).toBe("src/components/agentMode/AgentThreadSession.tsx");
    expect(label("Edit", `${ROOT}/README.md`, "ok", { workspaceRoot: `${ROOT}/` }).subject).toBe(
      "README.md",
    );
  });

  it("falls back to the parent directory and basename outside the root", () => {
    expect(label("Read", "/other/place/deep/file.ts", "ok", { workspaceRoot: ROOT }).subject).toBe(
      "deep/file.ts",
    );
    expect(label("Read", "src/app.ts").subject).toBe("src/app.ts");
    expect(label("Read", "app.ts").subject).toBe("app.ts");
    expect(label("Read", `${ROOT}`, "ok", { workspaceRoot: ROOT }).subject).toBe("projects/editor");
  });

  it("treats windows separators as path separators", () => {
    expect(
      label("Write", "C:\\work\\editor\\src\\main.ts", "ok", { workspaceRoot: "C:\\work\\editor" })
        .subject,
    ).toBe("src/main.ts");
  });

  it("keeps the pattern as the subject for searches and leaves no argument", () => {
    expect(label("Grep", "todo|fixme")).toEqual({
      verb: "Searched",
      subject: "todo|fixme",
      argument: null,
    });
    expect(label("Glob", "**/*.tsx").argument).toBeNull();
  });

  it("names the tool itself when nothing else identifies the call", () => {
    expect(label("TodoWrite", '{"todos":[]}')).toEqual({
      verb: "Called",
      subject: "TodoWrite",
      argument: '{"todos":[]}',
    });
    expect(label("", "").subject).toBe("tool");
  });

  it("drops the argument when it repeats the subject", () => {
    expect(label("Bash", "ls").argument).toBeNull();
    expect(label("Bash", "ls -la").argument).toBe("ls -la");
  });

  it("collapses newlines in the subject and the argument", () => {
    const row = label("Bash", "grep foo \\\n  src\n");
    expect(row.subject).toBe("grep");
    expect(row.argument).toBe("grep foo \\ src");
  });

  it("bounds every string it produces", () => {
    const huge = `echo ${"ú".repeat(5_000)}`;
    const row = label("Bash", huge, "running");
    expect([...row.subject].length).toBeLessThanOrEqual(MAX_AGENT_TOOL_ROW_SUBJECT_CHARS);
    expect(new TextEncoder().encode(row.argument ?? "").byteLength).toBeLessThanOrEqual(
      MAX_AGENT_TOOL_SUMMARY_BYTES,
    );
    const name = label("x".repeat(400), "", "ok");
    expect([...name.subject].length).toBeLessThanOrEqual(MAX_AGENT_TOOL_ROW_SUBJECT_CHARS);
  });

  it("never splits a surrogate pair while clipping", () => {
    const row = label("Grep", "🙂".repeat(200));
    expect(
      [...row.subject].every((character) => character === "🙂" || character === "\u2026"),
    ).toBe(true);
  });
});
