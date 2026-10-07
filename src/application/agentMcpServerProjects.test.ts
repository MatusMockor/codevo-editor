import { describe, expect, it, vi } from "vitest";
import {
  REMOTE_RUNNER_COMMANDS,
  TauriRemoteRunnerGateway,
} from "../infrastructure/tauriRemoteRunnerGateway";
import { DeferredRunnerTunnel, mcpRunnerFixture } from "../test/agentMcpServersTestSupport";
import {
  AgentMcpServerProjectsStore,
  MAX_AGENT_MCP_SERVER_HOSTS,
  MAX_AGENT_MCP_SERVER_HOST_PROJECTS,
  NO_AGENT_MCP_SERVER_HOSTS,
} from "./agentMcpServerProjects";

const LINUX = { id: "linux", name: "Linux box", connection: {} };
const MAC = { id: "mac", name: "Mac mini", connection: {} };
const LINUX_NAME = { id: "linux", name: "Linux box" };
const MAC_NAME = { id: "mac", name: "Mac mini" };
const projects = [
  { id: "codevo-editor", name: "Codevo Editor" },
  { id: "api", name: "api" },
];

function setup() {
  const tunnel = new DeferredRunnerTunnel();
  const store = new AgentMcpServerProjectsStore(new TauriRemoteRunnerGateway(tunnel.invoke));
  const published = vi.fn();
  const watch = () => store.subscribe(published);
  return { published, store, tunnel, watch };
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
}

function inventories(store: AgentMcpServerProjectsStore) {
  return store.state().hosts.map((host) => [host.server.id, host.inventory.kind]);
}

describe("AgentMcpServerProjectsStore", () => {
  it("knows connected servers without reading them until it is asked to load", async () => {
    vi.useFakeTimers();
    try {
      const { published, store, tunnel } = setup();
      expect(store.state()).toBe(NO_AGENT_MCP_SERVER_HOSTS);
      store.connect([LINUX, MAC]);
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1_000);
      expect(vi.getTimerCount()).toBe(0);
      expect(tunnel.calls).toEqual([]);
      expect(inventories(store)).toEqual([
        ["linux", "idle"],
        ["mac", "idle"],
      ]);
      expect(published).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("loads the runner identity, capability, and projects of each connected server", async () => {
    const { published, store, tunnel, watch } = setup();
    store.connect([LINUX, MAC]);
    watch();
    store.load();
    expect(inventories(store)).toEqual([
      ["linux", "loading"],
      ["mac", "loading"],
    ]);
    expect(tunnel.requests(REMOTE_RUNNER_COMMANDS.getRunner)).toEqual([
      { serverId: "linux" },
      { serverId: "mac" },
    ]);
    expect(tunnel.requests(REMOTE_RUNNER_COMMANDS.listProjects)).toEqual([
      { serverId: "linux" },
      { serverId: "mac" },
    ]);

    tunnel.serve("linux", mcpRunnerFixture("runner-home"), projects);
    tunnel.serve("mac", mcpRunnerFixture("runner-old", "absent"), []);
    await settle();
    expect(store.state().hosts).toEqual([
      {
        server: LINUX_NAME,
        inventory: {
          kind: "ready",
          runnerId: "runner-home",
          supported: true,
          projects,
          truncated: false,
          stale: false,
        },
      },
      {
        server: MAC_NAME,
        inventory: {
          kind: "ready",
          runnerId: "runner-old",
          supported: false,
          projects: [],
          truncated: false,
          stale: false,
        },
      },
    ]);
    expect(published).toHaveBeenCalledTimes(3);
    expect(store.state()).toBe(store.state());
    expect(Object.isFrozen(store.state().hosts)).toBe(true);
  });

  it("treats a capability that is false or missing as unsupported", async () => {
    const { store, tunnel } = setup();
    store.connect([LINUX, MAC]);
    store.load();
    tunnel.serve("linux", mcpRunnerFixture("runner-a", false), projects);
    tunnel.serve("mac", mcpRunnerFixture("runner-b", "absent"), projects);
    await settle();
    expect(store.support("linux", "runner-a")).toBe("unsupported");
    expect(store.support("mac", "runner-b")).toBe("unsupported");
  });

  it("answers support only for the exact connected server and runner identity", async () => {
    const { store, tunnel } = setup();
    store.connect([LINUX]);
    expect(store.support("linux", "runner-home")).toBe("unavailable");
    store.load();
    expect(store.support("linux", "runner-home")).toBe("unavailable");
    tunnel.serve("linux", mcpRunnerFixture("runner-home"), projects);
    await settle();
    expect(store.support("linux", "runner-home")).toBe("supported");
    expect(store.support("linux", "runner-other")).toBe("unavailable");
    expect(store.support("mac", "runner-home")).toBe("unavailable");
    store.connect([]);
    expect(store.support("linux", "runner-home")).toBe("unavailable");
  });

  it("reports a server whose runner cannot be read as failed and retries on the next load", async () => {
    const { store, tunnel } = setup();
    store.connect([LINUX]);
    store.load();
    tunnel.refuse("linux", "Server connection changed during request");
    await settle();
    expect(inventories(store)).toEqual([["linux", "failed"]]);
    expect(store.support("linux", "runner-home")).toBe("unavailable");

    store.load();
    expect(inventories(store)).toEqual([["linux", "loading"]]);
    tunnel.serve("linux", mcpRunnerFixture("runner-home"), projects);
    await settle();
    expect(inventories(store)).toEqual([["linux", "ready"]]);
  });

  it("keeps a known project list, marked stale, when reading it again fails", async () => {
    const { published, store, tunnel, watch } = setup();
    store.connect([LINUX]);
    store.load();
    tunnel.serve("linux", mcpRunnerFixture("runner-home"), projects);
    await settle();
    watch();

    store.load();
    tunnel.refuse("linux", "Server connection changed during request");
    await settle();
    expect(store.state().hosts).toEqual([
      {
        server: LINUX_NAME,
        inventory: {
          kind: "ready",
          runnerId: "runner-home",
          supported: true,
          projects,
          truncated: false,
          stale: true,
        },
      },
    ]);
    expect(store.support("linux", "runner-home")).toBe("supported");
    expect(published).toHaveBeenCalledTimes(1);

    store.load();
    tunnel.serve("linux", mcpRunnerFixture("runner-home"), projects.slice(0, 1));
    await settle();
    expect(store.state().hosts[0]?.inventory).toMatchObject({
      kind: "ready",
      projects: projects.slice(0, 1),
      stale: false,
    });
  });

  it("forgets what it knew when the same server id comes back on a new connection", async () => {
    const { store, tunnel } = setup();
    store.connect([LINUX]);
    store.load();
    tunnel.serve("linux", mcpRunnerFixture("runner-home"), projects);
    await settle();

    store.connect([{ ...LINUX }]);
    expect(store.support("linux", "runner-home")).toBe("supported");
    expect(tunnel.requests(REMOTE_RUNNER_COMMANDS.getRunner)).toHaveLength(1);

    store.connect([{ ...LINUX, connection: {} }]);
    expect(inventories(store)).toEqual([["linux", "idle"]]);
    expect(store.support("linux", "runner-home")).toBe("unavailable");
    expect(tunnel.requests(REMOTE_RUNNER_COMMANDS.getRunner)).toHaveLength(1);
  });

  it("reads a server again on a new connection only while someone is watching", async () => {
    const { store, tunnel, watch } = setup();
    watch();
    store.connect([LINUX]);
    tunnel.serve("linux", mcpRunnerFixture("runner-home"), projects);
    await settle();
    expect(store.support("linux", "runner-home")).toBe("supported");

    store.connect([LINUX]);
    store.connect([{ ...LINUX }]);
    expect(tunnel.requests(REMOTE_RUNNER_COMMANDS.getRunner)).toHaveLength(1);

    store.connect([{ ...LINUX, connection: {} }]);
    expect(inventories(store)).toEqual([["linux", "loading"]]);
    expect(store.support("linux", "runner-home")).toBe("unavailable");
    expect(tunnel.requests(REMOTE_RUNNER_COMMANDS.getRunner)).toHaveLength(2);

    tunnel.serve("linux", mcpRunnerFixture("runner-replaced"), projects);
    await settle();
    expect(store.support("linux", "runner-home")).toBe("unavailable");
    expect(store.support("linux", "runner-replaced")).toBe("supported");
  });

  it("drops the late answer of the previous connection of the same server", async () => {
    const { store, tunnel, watch } = setup();
    watch();
    store.connect([LINUX]);
    const [staleRunner] = tunnel.pending(REMOTE_RUNNER_COMMANDS.getRunner, "linux");
    const [staleProjects] = tunnel.pending(REMOTE_RUNNER_COMMANDS.listProjects, "linux");

    store.connect([{ ...LINUX, connection: {} }]);
    staleRunner?.resolve(mcpRunnerFixture("runner-home"));
    staleProjects?.resolve({ items: projects });
    await settle();
    expect(inventories(store)).toEqual([["linux", "loading"]]);
    expect(store.support("linux", "runner-home")).toBe("unavailable");
  });

  it("fails closed when the runner answers with a malformed descriptor", async () => {
    const { store, tunnel } = setup();
    store.connect([LINUX]);
    store.load();
    tunnel.serve("linux", { ...mcpRunnerFixture("runner-home"), runnerId: "" }, projects);
    await settle();
    expect(inventories(store)).toEqual([["linux", "failed"]]);
  });

  it("reads each server once no matter how often a load is asked", async () => {
    const { store, tunnel } = setup();
    store.connect([LINUX]);
    store.load();
    store.load();
    store.connect([LINUX]);
    store.load();
    expect(tunnel.requests(REMOTE_RUNNER_COMMANDS.getRunner)).toHaveLength(1);
    tunnel.serve("linux", mcpRunnerFixture("runner-home"), projects);
    await settle();
    store.load();
    expect(tunnel.requests(REMOTE_RUNNER_COMMANDS.getRunner)).toHaveLength(2);
  });

  it("keeps showing a loaded server while it is read again and waits for that read", async () => {
    const { published, store, tunnel, watch } = setup();
    store.connect([LINUX]);
    store.load();
    tunnel.serve("linux", mcpRunnerFixture("runner-home", false), projects);
    await settle();
    watch();
    const before = store.state();

    store.load();
    expect(store.state()).toBe(before);
    expect(published).not.toHaveBeenCalled();
    const confirmed = vi.fn();
    void store.confirm("linux", "runner-home").then(confirmed);
    await settle();
    expect(confirmed).not.toHaveBeenCalled();

    tunnel.serve("linux", mcpRunnerFixture("runner-home", true), projects);
    await settle();
    expect(confirmed).toHaveBeenCalledExactlyOnceWith("supported");
    expect(published).toHaveBeenCalledTimes(1);
  });

  it("confirms from what is already known when no read is running", async () => {
    const { store, tunnel } = setup();
    store.connect([LINUX]);
    expect(await store.confirm("linux", "runner-home")).toBe("unavailable");
    store.load();
    tunnel.serve("linux", mcpRunnerFixture("runner-home"), projects);
    await settle();
    expect(await store.confirm("linux", "runner-home")).toBe("supported");
    expect(await store.confirm("linux", "runner-replaced")).toBe("unavailable");
    expect(tunnel.requests(REMOTE_RUNNER_COMMANDS.getRunner)).toHaveLength(1);
  });

  it("drops the late answer of a server that disconnected and reconnected meanwhile", async () => {
    const { store, tunnel, watch } = setup();
    watch();
    store.connect([LINUX]);
    expect(inventories(store)).toEqual([["linux", "loading"]]);
    const [staleRunner] = tunnel.pending(REMOTE_RUNNER_COMMANDS.getRunner, "linux");
    const [staleProjects] = tunnel.pending(REMOTE_RUNNER_COMMANDS.listProjects, "linux");

    store.connect([]);
    expect(store.state().hosts).toEqual([]);
    store.connect([LINUX]);
    expect(tunnel.requests(REMOTE_RUNNER_COMMANDS.getRunner)).toHaveLength(2);

    staleRunner?.resolve(mcpRunnerFixture("runner-home"));
    staleProjects?.resolve({ items: projects });
    await settle();
    expect(inventories(store)).toEqual([["linux", "loading"]]);
    expect(store.support("linux", "runner-home")).toBe("unavailable");

    tunnel.serve("linux", mcpRunnerFixture("runner-replaced"), []);
    await settle();
    expect(store.support("linux", "runner-home")).toBe("unavailable");
    expect(store.support("linux", "runner-replaced")).toBe("supported");
  });

  it("forgets a disconnected server at once and keeps the others untouched", async () => {
    const { published, store, tunnel, watch } = setup();
    store.connect([LINUX, MAC]);
    store.load();
    tunnel.serve("linux", mcpRunnerFixture("runner-home"), projects);
    tunnel.serve("mac", mcpRunnerFixture("runner-mac"), []);
    await settle();
    watch();
    const mac = store.state().hosts[1];

    store.connect([MAC]);
    expect(store.state().hosts).toEqual([mac]);
    expect(store.state().hosts[0]).toBe(mac);
    expect(store.support("linux", "runner-home")).toBe("unavailable");
    expect(store.support("mac", "runner-mac")).toBe("supported");
    expect(published).toHaveBeenCalledTimes(1);

    store.connect([MAC]);
    expect(published).toHaveBeenCalledTimes(1);
  });

  it("reads a newly connected server by itself only while someone is watching", async () => {
    const { store, tunnel, watch } = setup();
    store.connect([LINUX]);
    expect(tunnel.calls).toEqual([]);
    const unwatch = watch();
    store.connect([LINUX, MAC]);
    expect(tunnel.requests(REMOTE_RUNNER_COMMANDS.getRunner)).toEqual([
      { serverId: "linux" },
      { serverId: "mac" },
    ]);
    unwatch();
    store.connect([LINUX, MAC, { id: "third", name: "Third", connection: {} }]);
    expect(tunnel.requests(REMOTE_RUNNER_COMMANDS.getRunner)).toHaveLength(2);
  });

  it("follows a server rename without reading it again", async () => {
    const { store, tunnel } = setup();
    store.connect([LINUX]);
    store.load();
    tunnel.serve("linux", mcpRunnerFixture("runner-home"), projects);
    await settle();
    store.connect([{ ...LINUX, name: "Build box" }]);
    expect(store.state().hosts[0]?.server).toEqual({ id: "linux", name: "Build box" });
    expect(Object.keys(store.state().hosts[0]?.server ?? {})).toEqual(["id", "name"]);
    expect(store.state().hosts[0]?.inventory.kind).toBe("ready");
    expect(tunnel.requests(REMOTE_RUNNER_COMMANDS.getRunner)).toHaveLength(1);
  });

  it("bounds the servers and the projects per server and says when it cut either", async () => {
    const { store, tunnel } = setup();
    const servers = Array.from({ length: MAX_AGENT_MCP_SERVER_HOSTS + 3 }, (_, index) => ({
      id: `server-${index}`,
      name: `Server ${index}`,
      connection: {},
    }));
    store.connect([...servers.slice(0, 2), servers[0] ?? LINUX, ...servers.slice(2)]);
    expect(store.state().hosts).toHaveLength(MAX_AGENT_MCP_SERVER_HOSTS);
    expect(store.state().truncated).toBe(true);
    expect(new Set(store.state().hosts.map((host) => host.server.id)).size).toBe(
      MAX_AGENT_MCP_SERVER_HOSTS,
    );

    store.connect(servers.slice(0, 1));
    expect(store.state().truncated).toBe(false);
    store.load();
    tunnel.serve(
      "server-0",
      mcpRunnerFixture("runner-home"),
      Array.from({ length: MAX_AGENT_MCP_SERVER_HOST_PROJECTS + 5 }, (_, index) => ({
        id: `project-${index}`,
        name: `project-${index}`,
      })),
    );
    await settle();
    const inventory = store.state().hosts[0]?.inventory;
    expect(inventory).toMatchObject({ kind: "ready", truncated: true });
    expect(inventory?.kind === "ready" ? inventory.projects.length : 0).toBe(
      MAX_AGENT_MCP_SERVER_HOST_PROJECTS,
    );
  });

  it("stays empty and silent without a remote gateway", async () => {
    const store = new AgentMcpServerProjectsStore(null);
    store.connect([LINUX]);
    store.load();
    expect(store.state()).toBe(NO_AGENT_MCP_SERVER_HOSTS);
    expect(await store.confirm("linux", "runner-home")).toBe("unavailable");
  });

  it("stops notifying a listener once it unsubscribes", () => {
    const { published, store, watch } = setup();
    const unwatch = watch();
    store.connect([LINUX]);
    expect(published).toHaveBeenCalledTimes(1);
    unwatch();
    store.connect([]);
    expect(published).toHaveBeenCalledTimes(1);
  });
});
