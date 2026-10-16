import { describe, expect, it } from "vitest";
import {
  MAX_AGENT_LINK_NOTICE_PATH_CHARS,
  MAX_AGENT_OUTSIDE_LINKED_FILE_BYTES,
  agentLocalFileLinkFailure,
  agentLocalFileLinkFailureMessage,
  agentLocalFileLinkFailureRemembered,
  agentLocalFileLinkPlace,
  type AgentOutsideFileRefusal,
} from "./agentLocalFileLinkFailure";

const PROJECT = agentLocalFileLinkPlace("project", "/Users/me/Developer/ebox-crm");
const OUTSIDE = "/Users/me/handoffs/oktober/02-cms-slideshow.md";

describe("outside file link failures", () => {
  it.each<[AgentOutsideFileRefusal, string]>([
    ["doesNotExist", `${OUTSIDE} doesn't exist.`],
    ["folder", `${OUTSIDE} is a folder, not a file.`],
    ["specialFile", `${OUTSIDE} isn't a regular file, so it wasn't opened.`],
    ["tooLarge", `${OUTSIDE} is larger than 10 MB, so it wasn't opened.`],
    ["notText", `${OUTSIDE} isn't a text file, so it wasn't opened.`],
    ["notLocal", `${OUTSIDE} is on a network or offloaded volume, so it wasn't opened.`],
    ["otherProject", `${OUTSIDE} belongs to another open project, so it wasn't opened here.`],
  ])("explains %s without calling the file a project file", (kind, message) => {
    const failure = agentLocalFileLinkFailure(kind, OUTSIDE, PROJECT);

    expect(agentLocalFileLinkFailureMessage(failure)).toBe(message);
    expect(agentLocalFileLinkFailureRemembered(kind)).toBe(true);
  });

  it("asks to retry a busy read and does not remember it as a property of the link", () => {
    const failure = agentLocalFileLinkFailure("busy", OUTSIDE, PROJECT);

    expect(agentLocalFileLinkFailureMessage(failure)).toBe(
      `Another linked file is still being read, so ${OUTSIDE} wasn't opened. Try again.`,
    );
    expect(agentLocalFileLinkFailureRemembered("busy")).toBe(false);
  });

  it("states the size limit the backend enforces", () => {
    expect(MAX_AGENT_OUTSIDE_LINKED_FILE_BYTES).toBe(10 * 1024 * 1024);
  });

  it("refuses a server thread's home path by the path the agent wrote", () => {
    const failure = agentLocalFileLinkFailure("serverHomePath", "~/.coderabbit/auth.json", PROJECT);

    expect(agentLocalFileLinkFailureMessage(failure)).toBe(
      "Server threads can't open files from a home folder, so ~/.coderabbit/auth.json wasn't opened.",
    );
    expect(agentLocalFileLinkFailureRemembered("serverHomePath")).toBe(true);
  });

  it("keeps the in-project wording for a file missing from its project", () => {
    const failure = agentLocalFileLinkFailure("notFound", "src/env.ts", PROJECT);

    expect(agentLocalFileLinkFailureMessage(failure)).toBe(
      "src/env.ts isn't in this project (ebox-crm).",
    );
  });

  it("bounds a long outside path in the middle and keeps its file name", () => {
    const long = `/Users/me/${"deep/".repeat(60)}handoff.md`;
    const failure = agentLocalFileLinkFailure("doesNotExist", long, PROJECT);

    expect(Array.from(failure.path).length).toBeLessThanOrEqual(MAX_AGENT_LINK_NOTICE_PATH_CHARS);
    expect(failure.path.startsWith("/Users/me/deep/")).toBe(true);
    expect(failure.path.endsWith("handoff.md")).toBe(true);
    expect(agentLocalFileLinkFailureMessage(failure)).toBe(`${failure.path} doesn't exist.`);
  });
});
