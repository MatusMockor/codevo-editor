import { describe, expect, it } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import {
  projectRemoteAgentThreads,
  remoteAgentProjectKey,
  remoteAgentThreadKey,
} from "../../application/remoteAgentProjection";
import type { RemoteRunnerTask } from "../../domain/remoteRunner";
import { agentRailFocusedEntries } from "./agentRailProjectLayout";
import {
  NO_AGENT_RAIL_STARTING_ROWS,
  agentRailPresentThreadIds,
  agentRailStartingRowLabel,
  agentRailStartingRowRuntime,
  agentRailStartingRows,
  type AgentRailStartingRows,
} from "./agentRailStartingRows";
import type { AgentRailScopeEntry } from "./agentSidebarPresentation";
import { NO_AGENT_STARTING_THREADS, type AgentStartingThread } from "./agentStartingThreads";
import { surfaceThreadView } from "./agentSurfaceTestFixtures";

const APP = "/workspace/app";
const API = "/workspace/api";
const REMOTE_APP = remoteAgentProjectKey("srv-1", "runner-1", "project-1");
const REMOTE_THREAD = remoteAgentThreadKey("srv-1", "runner-1", "task-1");

function entry(
  projectRootKey: string,
  memberProjectRootKeys?: ReadonlyArray<string>,
): AgentRailScopeEntry {
  return {
    memberProjectRootKeys,
    value: projectRootKey,
    label: projectRootKey,
    projectRootKey,
    repositoryRoot: projectRootKey,
    trust: "trusted",
    origin: "active-tab",
    rootPath: projectRootKey,
    repositoryCount: 1,
    serverPresence: { local: true, remoteServerIds: [] },
  };
}

function starting(
  key: string,
  projectRootKey: string,
  patch: Partial<AgentStartingThread> = {},
): AgentStartingThread {
  return {
    key,
    projectRootKey,
    owner: { ownerId: `agent-root:${projectRootKey}`, generation: 1 },
    provider: "claudeCode",
    threadId: null,
    title: `Title ${key}`,
    sentAtEpochMs: 1,
    current: false,
    ...patch,
  };
}

function view(threadId: string, rootKey: string, archived = false): AgentThreadView {
  const base = surfaceThreadView().thread;
  return surfaceThreadView({
    thread: {
      ...base,
      threadId,
      archived,
      owner: { rootKey, ownerId: `agent-root:${rootKey}`, repositoryRoot: rootKey },
    },
  });
}

function remoteTask(patch: Partial<RemoteRunnerTask>): RemoteRunnerTask {
  return {
    id: "task-1",
    runnerId: "runner-1",
    sequence: 1,
    provider: "claude",
    status: "queued",
    projectId: "project-1",
    parts: [{ type: "text", text: "Add a health check" }],
    createdAt: "2026-09-13T00:00:00Z",
    ...patch,
  };
}

function projected(task: RemoteRunnerTask): ReadonlyArray<AgentThreadView> {
  return projectRemoteAgentThreads({
    serverId: "srv-1",
    runnerId: "runner-1",
    projects: [{ id: "project-1", name: "Server app" }],
    tasks: [task],
    replays: new Map(),
    resumes: new Map(),
  });
}

function rows(
  threads: ReadonlyArray<AgentStartingThread>,
  entries: ReadonlyArray<AgentRailScopeEntry>,
  views: ReadonlyArray<AgentThreadView> = [],
  visibleEntries: ReadonlyArray<AgentRailScopeEntry> = entries,
  previous?: AgentRailStartingRows,
): AgentRailStartingRows {
  return agentRailStartingRows({ threads, visibleEntries, entries, views }, previous);
}

describe("agent rail starting rows", () => {
  it("returns the shared empty map when nothing is starting", () => {
    expect(rows(NO_AGENT_STARTING_THREADS, [entry(APP)], [view("agt-1", APP)])).toBe(
      NO_AGENT_RAIL_STARTING_ROWS,
    );
  });

  it("places a starting thread under exactly its own project", () => {
    const thread = starting("starting:1", APP);
    const result = rows([thread], [entry(APP), entry(API)]);

    expect([...result.keys()]).toEqual([APP]);
    expect(result.get(APP)).toEqual([thread]);
    expect(result.get(API)).toBeUndefined();
  });

  it("maps a member project key to the environment group that owns it", () => {
    const local = starting("starting:1", APP);
    const remote = starting("starting:2", REMOTE_APP);
    const result = rows([local, remote], [entry(APP, [APP, REMOTE_APP]), entry(API)]);

    expect([...result.keys()]).toEqual([APP]);
    expect(result.get(APP)).toEqual([remote, local]);
  });

  it("groups a remote project under its remote key", () => {
    const remote = starting("starting:1", REMOTE_APP);

    expect(rows([remote], [entry(APP), entry(REMOTE_APP)]).get(REMOTE_APP)).toEqual([remote]);
  });

  it("drops a starting thread whose project is not shown", () => {
    const entries = [entry(APP), entry(API)];
    const focused = agentRailFocusedEntries(entries, "active", APP);

    expect(rows([starting("starting:1", API)], entries, [], focused)).toBe(
      NO_AGENT_RAIL_STARTING_ROWS,
    );
    expect(rows([starting("starting:1", "/workspace/unknown")], entries)).toBe(
      NO_AGENT_RAIL_STARTING_ROWS,
    );
  });

  it("lists the newest starting thread first", () => {
    const first = starting("starting:1", APP);
    const second = starting("starting:2", APP);

    expect(rows([first, second], [entry(APP)]).get(APP)).toEqual([second, first]);
  });

  it("keeps an identified starting thread until a thread with exactly that id exists", () => {
    const thread = starting("starting:1", APP, { threadId: "agt-new" });
    const entries = [entry(APP), entry(API)];

    expect(rows([thread], entries, [view("agt-old", APP)]).get(APP)).toEqual([thread]);
    expect(rows([thread], entries, [view("agt-new-2", APP)]).get(APP)).toEqual([thread]);
    expect(rows([thread], entries, [view("agt-old", APP), view("agt-new", APP)])).toBe(
      NO_AGENT_RAIL_STARTING_ROWS,
    );
  });

  it("never retires an unidentified starting thread, whatever threads exist", () => {
    const thread = starting("starting:1", APP);

    expect(rows([thread], [entry(APP)], [view("agt-new", APP)]).get(APP)).toEqual([thread]);
    expect(agentRailPresentThreadIds([thread], [view("agt-new", APP)], [entry(APP)]).size).toBe(0);
  });

  it("retires only the starting thread whose id is present", () => {
    const retired = starting("starting:1", APP, { threadId: "agt-1" });
    const waiting = starting("starting:2", APP, { threadId: "agt-2" });
    const unidentified = starting("starting:3", API);

    const result = rows(
      [retired, waiting, unidentified],
      [entry(APP), entry(API)],
      [view("agt-1", APP)],
    );

    expect(result.get(APP)).toEqual([waiting]);
    expect(result.get(API)).toEqual([unidentified]);
  });

  it("retires the starting thread when the real thread exists but is hidden from the rail", () => {
    const thread = starting("starting:1", APP, { threadId: "agt-new" });
    const entries = [entry(APP), entry(API)];
    const focusedOnApi = agentRailFocusedEntries(entries, "active", API);

    expect(rows([thread], entries, [view("agt-new", APP, true)])).toBe(NO_AGENT_RAIL_STARTING_ROWS);
    expect(rows([thread], entries, [view("agt-new", APP)], focusedOnApi)).toBe(
      NO_AGENT_RAIL_STARTING_ROWS,
    );
    expect(
      rows(
        [starting("starting:2", REMOTE_APP, { threadId: "agt-member" })],
        [entry(APP, [APP, REMOTE_APP])],
        [view("agt-member", REMOTE_APP)],
      ),
    ).toBe(NO_AGENT_RAIL_STARTING_ROWS);
  });

  it("keeps the starting thread while the server draft has no project yet", () => {
    const thread = starting("starting:1", REMOTE_APP, { threadId: REMOTE_THREAD });
    const entries = [entry(REMOTE_APP)];
    const draft = projected(remoteTask({ status: "draft", projectId: undefined }));
    const queued = projected(remoteTask({ status: "queued" }));

    expect(draft.map((item) => item.thread.threadId)).toEqual([REMOTE_THREAD]);
    expect(draft[0]?.thread.owner.rootKey).not.toBe(REMOTE_APP);
    expect(rows([thread], entries, draft).get(REMOTE_APP)).toEqual([thread]);
    expect(queued[0]?.thread.owner.rootKey).toBe(REMOTE_APP);
    expect(rows([thread], entries, queued)).toBe(NO_AGENT_RAIL_STARTING_ROWS);
  });

  it("keeps the same map and row lists while the rows did not change", () => {
    const app = starting("starting:1", APP, { threadId: "agt-1" });
    const api = starting("starting:2", API);
    const entries = [entry(APP), entry(API)];
    const first = rows([app, api], entries, [view("agt-old", APP)]);

    const unrelated = rows(
      [app, api],
      entries,
      [view("agt-old", APP), view("agt-other", API)],
      entries,
      first,
    );
    expect(unrelated).toBe(first);

    const retired = rows([app, api], entries, [view("agt-1", APP)], entries, first);
    expect(retired).not.toBe(first);
    expect([...retired.keys()]).toEqual([API]);
    expect(retired.get(API)).toBe(first.get(API));
  });

  it("labels the row and its runtime like a thread row", () => {
    const local = starting("starting:1", APP, { title: "Add a health check", provider: "codex" });
    const remote = starting("starting:2", REMOTE_APP);
    const names = new Map([["srv-1", "Build box"]]);

    expect(agentRailStartingRowLabel(local)).toBe("Starting thread: Add a health check");
    expect(agentRailStartingRowRuntime(local, names)).toEqual({
      place: "local",
      provider: "codex",
      label: "Codex, local",
    });
    expect(agentRailStartingRowRuntime(remote, names)).toEqual({
      place: "server",
      provider: "claudeCode",
      label: "Claude Code, on Build box",
    });
    expect(agentRailStartingRowRuntime(remote, new Map())).toEqual({
      place: "server",
      provider: "claudeCode",
      label: "Claude Code, on server",
    });
  });
});
