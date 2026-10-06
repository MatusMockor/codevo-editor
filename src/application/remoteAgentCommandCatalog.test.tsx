// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import type { AgentThreadView, RemoteAgentCommandCatalogAccess } from "./agentThreadPorts";
import {
  MAX_REMOTE_COMMAND_CATALOG_RUNNERS,
  remoteCommandCatalogAccess,
  remoteCommandCatalogRunners,
  remoteComposerCommandCatalogProject,
  useRemoteAgentCommandCatalogAccess,
} from "./remoteAgentCommandCatalog";
import { remoteAgentProjectKey } from "./remoteAgentProjection";

type Options = Parameters<typeof remoteCommandCatalogRunners>[0];
type Snapshot = Options["snapshots"][number];

const gateway: NonNullable<Options["gateway"]> = {
  getCommandCatalog: () => new Promise(() => undefined),
};

function runner(
  serverId: string,
  runnerId: string,
  commandCatalog: boolean | "absent" = true,
  connected = true,
): Snapshot {
  return {
    serverId,
    connected,
    descriptor: {
      protocolVersion: 1,
      runnerId,
      name: runnerId,
      capabilities: {
        taskExecution: true,
        eventReplay: true,
        ...(commandCatalog === "absent" ? {} : { commandCatalog }),
      },
    },
  };
}

function options(overrides: Partial<Options> = {}): Options {
  return {
    gateway,
    servers: [
      { id: "server-a", connected: true },
      { id: "server-b", connected: true },
    ],
    snapshots: [runner("server-a", "runner-a"), runner("server-b", "runner-b")],
    ...overrides,
  };
}

function accessFor(overrides: Partial<Options> = {}): RemoteAgentCommandCatalogAccess | undefined {
  return remoteCommandCatalogAccess(remoteCommandCatalogRunners(options(overrides)));
}

function remoteThread(serverId: string, runnerId: string, projectId: string): AgentThreadView {
  return { execution: { kind: "remote", serverId, runnerId, projectId } } as AgentThreadView;
}

const localThread = {} as AgentThreadView;
const keyA = remoteAgentProjectKey("server-a", "runner-a", "codevo-editor");

describe("remote command catalog access", () => {
  it("resolves the exact server, runner and project of a capable connected runner", () => {
    expect(accessFor()?.project(keyA)).toEqual({
      serverId: "server-a",
      runnerId: "runner-a",
      projectId: "codevo-editor",
    });
    expect(accessFor()?.project(remoteAgentProjectKey("server-b", "runner-b", "other"))).toEqual({
      serverId: "server-b",
      runnerId: "runner-b",
      projectId: "other",
    });
  });

  it.each([
    ["the capability is false", { snapshots: [runner("server-a", "runner-a", false)] }],
    ["the capability is missing", { snapshots: [runner("server-a", "runner-a", "absent")] }],
    ["the inventory is disconnected", { snapshots: [runner("server-a", "runner-a", true, false)] }],
    ["the server is disconnected", { servers: [{ id: "server-a", connected: false }] }],
    ["the server is no longer configured", { servers: [] }],
    [
      "the runner has not described itself yet",
      { snapshots: [{ serverId: "server-a", connected: true, descriptor: null }] },
    ],
    ["there is no gateway", { gateway: null }],
    ["the gateway cannot read catalogs", { gateway: {} }],
  ] as const)("offers nothing when %s", (_name, overrides) => {
    expect(accessFor(overrides)?.project(keyA) ?? null).toBeNull();
  });

  it("refuses a project of a runner identity that is no longer the connected one", () => {
    const access = accessFor({ snapshots: [runner("server-a", "runner-replaced")] });
    expect(access?.project(keyA)).toBeNull();
    expect(
      access?.project(remoteAgentProjectKey("server-a", "runner-replaced", "codevo-editor")),
    ).not.toBeNull();
  });

  it("refuses a capable runner's identity on a different server", () => {
    const access = accessFor({ snapshots: [runner("server-a", "runner-a")] });
    expect(
      access?.project(remoteAgentProjectKey("server-b", "runner-a", "codevo-editor")),
    ).toBeNull();
  });

  it.each(["/workspace/app", "", "remote:server-a:runner-a", "local:server-a:runner-a:project"])(
    "refuses the non-remote project key %j",
    (key) => {
      expect(accessFor()?.project(key)).toBeNull();
    },
  );

  it("considers a bounded number of servers", () => {
    const count = MAX_REMOTE_COMMAND_CATALOG_RUNNERS + 5;
    const runners = remoteCommandCatalogRunners({
      gateway,
      servers: Array.from({ length: count }, (_, index) => ({
        id: `server-${index}`,
        connected: true,
      })),
      snapshots: Array.from({ length: count }, (_, index) =>
        runner(`server-${index}`, `runner-${index}`),
      ),
    });
    expect(runners).toHaveLength(MAX_REMOTE_COMMAND_CATALOG_RUNNERS);
  });
});

describe("remote composer command catalog project", () => {
  it("uses the thread's own project for a remote thread, not the composer's", () => {
    expect(
      remoteComposerCommandCatalogProject(
        accessFor(),
        remoteAgentProjectKey("server-b", "runner-b", "other"),
        remoteThread("server-a", "runner-a", "codevo-editor"),
      ),
    ).toEqual({ serverId: "server-a", runnerId: "runner-a", projectId: "codevo-editor" });
  });

  it("uses the composer's project for a draft", () => {
    expect(remoteComposerCommandCatalogProject(accessFor(), keyA, null)?.projectId).toBe(
      "codevo-editor",
    );
  });

  it.each([
    ["a draft without a resolved project", null, null],
    ["a draft in a local project", "/workspace/app", null],
    ["a local thread, even inside a server project selection", keyA, localThread],
    [
      "a remote thread whose runner identity was replaced",
      keyA,
      remoteThread("server-a", "runner-old", "codevo-editor"),
    ],
  ] as const)("resolves nothing for %s", (_name, rootKey, thread) => {
    expect(remoteComposerCommandCatalogProject(accessFor(), rootKey, thread)).toBeNull();
  });

  it("resolves nothing without any capable runner", () => {
    expect(remoteComposerCommandCatalogProject(undefined, keyA, null)).toBeNull();
    expect(accessFor({ snapshots: [] })).toBeUndefined();
  });
});

describe("useRemoteAgentCommandCatalogAccess", () => {
  it("keeps one access object until the set of capable runners changes", () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const root = createRoot(document.createElement("div"));
    const seen: Array<RemoteAgentCommandCatalogAccess | undefined> = [];
    function Harness({ current }: { readonly current: Options }) {
      seen.push(useRemoteAgentCommandCatalogAccess(current));
      return null;
    }
    act(() => root.render(<Harness current={options()} />));
    act(() => root.render(<Harness current={options()} />));
    expect(seen[1]).toBe(seen[0]);
    expect(seen[0]?.project(keyA)).not.toBeNull();
    act(() =>
      root.render(
        <Harness current={options({ snapshots: [runner("server-a", "runner-replaced")] })} />,
      ),
    );
    expect(seen[2]).not.toBe(seen[0]);
    expect(seen[2]?.project(keyA)).toBeNull();
    act(() => root.render(<Harness current={options({ servers: [] })} />));
    expect(seen[3]).toBeUndefined();
    act(() => root.unmount());
  });
});
