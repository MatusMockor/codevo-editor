import { describe, expect, it } from "vitest";
import wireContract from "../../contracts/agent-mcp-servers-wire.json";
import {
  AGENT_MCP_SERVER_ENDPOINT_ORIGIN_PATTERN,
  AGENT_MCP_SERVER_SCOPES,
  AGENT_MCP_SERVER_STATUSES,
  AGENT_MCP_SERVER_TRANSPORTS,
  AGENT_MCP_SERVERS_ERROR_KINDS,
  AGENT_MCP_SERVERS_ERRORS,
  AGENT_MCP_SERVERS_LIMITS,
  agentMcpProviderProgram,
  agentMcpServerSignInCommand,
  agentMcpServersErrorKind,
  agentMcpServersRequest,
  isAgentMcpRepositoryRoot,
  parseAgentMcpServers,
  parseAgentMcpServersRequest,
} from "./agentMcpServers";

const LIMITS = AGENT_MCP_SERVERS_LIMITS;

function server(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "docs",
    status: "connected",
    scope: "user",
    transport: "http",
    endpointOrigin: null,
    toolCount: null,
    detail: null,
    ...overrides,
  };
}

function claude(servers: ReadonlyArray<unknown>): Record<string, unknown> {
  return { version: 1, provider: "claudeCode", truncated: false, servers };
}

function needsAuth(name: string) {
  return { name, status: "needsAuth" } as const;
}

describe("agent MCP servers wire contract", () => {
  it("keeps the domain limits, enums, and errors identical to the shared contract", () => {
    const { endpointOriginPattern, ...limits } = wireContract.limits;
    expect(wireContract.schemaVersion).toBe(1);
    expect({ ...LIMITS }).toEqual(limits);
    expect(AGENT_MCP_SERVER_ENDPOINT_ORIGIN_PATTERN.source).toBe(
      new RegExp(endpointOriginPattern).source,
    );
    expect(AGENT_MCP_SERVER_ENDPOINT_ORIGIN_PATTERN.flags).toBe("");
    expect([...AGENT_MCP_SERVER_STATUSES]).toEqual(wireContract.statuses);
    expect([...AGENT_MCP_SERVER_SCOPES]).toEqual(wireContract.scopes);
    expect([...AGENT_MCP_SERVER_TRANSPORTS]).toEqual(wireContract.transports);
    expect({ ...AGENT_MCP_SERVERS_ERRORS }).toEqual(wireContract.errors);
    expect([...AGENT_MCP_SERVERS_ERROR_KINDS]).toEqual(Object.keys(wireContract.errors));
  });

  it.each(wireContract.responses)("accepts the $name fixture unchanged", ({ value }) => {
    const parsed = parseAgentMcpServers(value);
    expect(parsed).toEqual(value);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.servers)).toBe(true);
    expect(parsed.servers.every((item) => Object.isFrozen(item))).toBe(true);
  });

  it.each(wireContract.rejectedResponses)("rejects the $name fixture", ({ value }) => {
    expect(() => parseAgentMcpServers(value)).toThrow(TypeError);
  });

  it.each(wireContract.requests)("accepts the $name request", ({ value }) => {
    expect(parseAgentMcpServersRequest(value)).toEqual(value);
  });

  it.each(wireContract.rejectedRequests)("rejects the $name request", ({ value }) => {
    expect(() => parseAgentMcpServersRequest(value)).toThrow(TypeError);
  });
});

describe("agent MCP servers parser", () => {
  it.each([null, undefined, 1, "servers", [], [claude([])]])("rejects a non-object %j", (value) => {
    expect(() => parseAgentMcpServers(value)).toThrow(TypeError);
  });

  it("bounds the server count and rejects the whole payload beyond it", () => {
    const servers = Array.from({ length: LIMITS.maxServers + 1 }, (_, index) =>
      server({ name: `server-${index}` }),
    );
    expect(parseAgentMcpServers(claude(servers.slice(0, -1))).servers).toHaveLength(
      LIMITS.maxServers,
    );
    expect(() => parseAgentMcpServers(claude(servers))).toThrow(TypeError);
    expect(() => parseAgentMcpServers({ ...claude([]), servers: {} })).toThrow(TypeError);
  });

  it("rejects one bad server instead of dropping it", () => {
    expect(() => parseAgentMcpServers(claude([server(), "docs"]))).toThrow(TypeError);
    expect(() =>
      parseAgentMcpServers(claude([server(), server({ name: "other", toolCount: "3" })])),
    ).toThrow(TypeError);
    expect(() => parseAgentMcpServers({ ...claude([]), truncated: "no" })).toThrow(TypeError);
    expect(() => parseAgentMcpServers({ ...claude([]), version: "1" })).toThrow(TypeError);
  });

  it("measures the name limit in UTF-8 bytes and keeps inner spaces", () => {
    const atLimit = "a".repeat(LIMITS.maxNameBytes);
    const multibyte = "é".repeat(LIMITS.maxNameBytes / 2 + 1);
    expect(multibyte.length).toBeLessThan(LIMITS.maxNameBytes);
    const parsed = parseAgentMcpServers(
      claude([server({ name: atLimit }), server({ name: "claude.ai Gmail" })]),
    );
    expect(parsed.servers.map((item) => item.name)).toEqual([atLimit, "claude.ai Gmail"]);
    expect(() => parseAgentMcpServers(claude([server({ name: `${atLimit}a` })]))).toThrow(
      TypeError,
    );
    expect(() => parseAgentMcpServers(claude([server({ name: multibyte })]))).toThrow(TypeError);
  });

  it.each(["", " docs", "docs ", "\tdocs", "do\u0000cs", "docs\u001b[31m", "a\u0085b", 7, null])(
    "rejects the name %j",
    (name) => {
      expect(() => parseAgentMcpServers(claude([server({ name })]))).toThrow(TypeError);
    },
  );

  it("treats names that differ only by case as distinct servers", () => {
    const parsed = parseAgentMcpServers(
      claude([server({ name: "Docs" }), server({ name: "docs" })]),
    );
    expect(parsed.servers.map((item) => item.name)).toEqual(["Docs", "docs"]);
  });

  it.each([
    "https://mcp.example.com",
    "http://127.0.0.1:8931",
    "https://[::1]:8080",
    `https://${"a".repeat(LIMITS.maxEndpointOriginBytes - "https://".length)}`,
  ])("accepts the endpoint origin %s on a network transport", (endpointOrigin) => {
    const parsed = parseAgentMcpServers(claude([server({ endpointOrigin })]));
    expect(parsed.servers[0]?.endpointOrigin).toBe(endpointOrigin);
  });

  it.each([
    "",
    "mcp.example.com",
    "ftp://mcp.example.com",
    "https://",
    "https://mcp.example.com/",
    "https://mcp.example.com?key=1",
    "https://mcp.example.com#frag",
    "https://user@mcp.example.com",
    "https://mcp.example.com evil",
    "https://mcp.example.com\u0000",
    `https://${"a".repeat(LIMITS.maxEndpointOriginBytes)}`,
    7,
  ])("rejects the endpoint origin %j", (endpointOrigin) => {
    expect(() => parseAgentMcpServers(claude([server({ endpointOrigin })]))).toThrow(TypeError);
  });

  it("allows an endpoint origin on every transport except stdio", () => {
    const endpointOrigin = "https://mcp.example.com";
    for (const transport of ["http", "sse", "unknown"]) {
      expect(
        parseAgentMcpServers(claude([server({ transport, endpointOrigin })])).servers,
      ).toHaveLength(1);
    }
    expect(() =>
      parseAgentMcpServers(claude([server({ transport: "stdio", endpointOrigin })])),
    ).toThrow(TypeError);
  });

  it("bounds the tool count to whole numbers inside the limit", () => {
    for (const toolCount of [0, 1, LIMITS.maxToolCount]) {
      expect(parseAgentMcpServers(claude([server({ toolCount })])).servers[0]?.toolCount).toBe(
        toolCount,
      );
    }
    for (const toolCount of [-1, 0.5, LIMITS.maxToolCount + 1, Number.NaN, Infinity, "3"]) {
      expect(() => parseAgentMcpServers(claude([server({ toolCount })]))).toThrow(TypeError);
    }
  });

  it("accepts a failure detail only on a failed server and bounds it", () => {
    const atLimit = "a".repeat(LIMITS.maxDetailBytes);
    const failed = parseAgentMcpServers(claude([server({ status: "failed", detail: atLimit })]));
    expect(failed.servers[0]?.detail).toBe(atLimit);
    expect(
      parseAgentMcpServers(claude([server({ status: "failed" })])).servers[0]?.detail,
    ).toBeNull();
    expect(() =>
      parseAgentMcpServers(claude([server({ status: "failed", detail: `${atLimit}a` })])),
    ).toThrow(TypeError);
    for (const status of AGENT_MCP_SERVER_STATUSES.filter((item) => item !== "failed")) {
      expect(() => parseAgentMcpServers(claude([server({ status, detail: "boom" })]))).toThrow(
        TypeError,
      );
    }
  });

  it("never leaks rejected payload text into the error", () => {
    const secret = "secret\npayload";
    let message = "";
    try {
      parseAgentMcpServers(claude([server({ name: secret })]));
    } catch (error) {
      message = String(error);
    }
    expect(message).toContain("servers[0].name");
    expect(message).not.toContain("secret");
  });
});

describe("agent MCP servers request", () => {
  it("builds a request only for an absolute, bounded workspace root", () => {
    expect(agentMcpServersRequest("/Users/dev/project", "codex")).toEqual({
      repositoryRoot: "/Users/dev/project",
      provider: "codex",
    });
    expect(agentMcpServersRequest("C:\\dev\\project", "claudeCode")).not.toBeNull();
    expect(agentMcpServersRequest(null, "codex")).toBeNull();
    expect(agentMcpServersRequest("", "codex")).toBeNull();
    expect(agentMcpServersRequest("project", "codex")).toBeNull();
    expect(agentMcpServersRequest("/dev/a\nb", "codex")).toBeNull();
  });

  it("judges a root with the predicate the request builder uses", () => {
    for (const root of ["/Users/dev/project", "C:\\dev\\project", "\\\\host\\share", "/"]) {
      expect(isAgentMcpRepositoryRoot(root), root).toBe(true);
      expect(agentMcpServersRequest(root, "codex")).not.toBeNull();
    }
    for (const root of ["", "project", "./project", "remote:linux:runner:project", "/a\nb"]) {
      expect(isAgentMcpRepositoryRoot(root), root).toBe(false);
      expect(agentMcpServersRequest(root, "codex")).toBeNull();
    }
    const atLimit = `/${"a".repeat(LIMITS.maxRepositoryRootBytes - 1)}`;
    expect(isAgentMcpRepositoryRoot(atLimit)).toBe(true);
    expect(isAgentMcpRepositoryRoot(`${atLimit}a`)).toBe(false);
  });

  it("bounds the root in UTF-8 bytes", () => {
    const atLimit = `/${"a".repeat(LIMITS.maxRepositoryRootBytes - 1)}`;
    expect(agentMcpServersRequest(atLimit, "codex")).not.toBeNull();
    expect(agentMcpServersRequest(`${atLimit}a`, "codex")).toBeNull();
    const multibyte = `/${"é".repeat(LIMITS.maxRepositoryRootBytes / 2)}`;
    expect(multibyte.length).toBeLessThan(LIMITS.maxRepositoryRootBytes);
    expect(agentMcpServersRequest(multibyte, "codex")).toBeNull();
  });
});

describe("agent MCP servers error classification", () => {
  it.each(AGENT_MCP_SERVERS_ERROR_KINDS)("recognizes the %s refusal", (kind) => {
    const text = wireContract.errors[kind];
    expect(agentMcpServersErrorKind(text)).toBe(kind);
    expect(agentMcpServersErrorKind(new Error(text))).toBe(kind);
    expect(agentMcpServersErrorKind(` ${text}\n`)).toBe(kind);
  });

  it.each([
    "workspace is not trusted",
    "",
    "agent mcp server status requires a trusted repository.",
    `${wireContract.errors.busy} Extra.`,
    new TypeError("Invalid agent MCP servers at agentMcpServers.version."),
    { message: wireContract.errors.busy },
    null,
    undefined,
    42,
  ])("classifies the unrecognized failure %j as unavailable", (error) => {
    expect(agentMcpServersErrorKind(error)).toBe("unavailable");
  });
});

describe("agent MCP server sign-in command", () => {
  it("names each provider's own CLI", () => {
    expect(agentMcpProviderProgram("claudeCode")).toBe("claude");
    expect(agentMcpProviderProgram("codex")).toBe("codex");
  });

  it("offers a login command for a server that needs sign-in", () => {
    expect(agentMcpServerSignInCommand("claudeCode", needsAuth("sentry"))).toBe(
      "claude mcp login -- 'sentry'",
    );
    expect(agentMcpServerSignInCommand("codex", needsAuth("sentry"))).toBe(
      "codex mcp login -- 'sentry'",
    );
  });

  it.each(AGENT_MCP_SERVER_SCOPES)(
    "offers the same login command for a %s server of either provider",
    (scope) => {
      const server = { ...needsAuth("claude.ai Gmail"), scope };
      expect(agentMcpServerSignInCommand("claudeCode", server)).toBe(
        "claude mcp login -- 'claude.ai Gmail'",
      );
      expect(agentMcpServerSignInCommand("codex", server)).toBe(
        "codex mcp login -- 'claude.ai Gmail'",
      );
    },
  );

  it.each([
    ["claude.ai Gmail", "'claude.ai Gmail'"],
    ["it's", "'it'\\''s'"],
    ["''", "''\\'''\\'''"],
    ['say "hi"', "'say \"hi\"'"],
    ["$HOME", "'$HOME'"],
    ["$(rm -rf ~)", "'$(rm -rf ~)'"],
    ["`whoami`", "'`whoami`'"],
    ["a;b|c&d", "'a;b|c&d'"],
    ["back\\slash", "'back\\slash'"],
  ])("quotes the name %j as one inert POSIX word", (name, quoted) => {
    expect(agentMcpServerSignInCommand("codex", needsAuth(name))).toBe(
      `codex mcp login -- ${quoted}`,
    );
  });

  it.each(["-x", "--help", "-", "--"])(
    "ends option parsing before the dash-led name %j",
    (name) => {
      expect(agentMcpServerSignInCommand("claudeCode", needsAuth(name))).toBe(
        `claude mcp login -- '${name}'`,
      );
      expect(agentMcpServerSignInCommand("codex", needsAuth(name))).toBe(
        `codex mcp login -- '${name}'`,
      );
    },
  );

  it.each(AGENT_MCP_SERVER_STATUSES.filter((status) => status !== "needsAuth"))(
    "offers no command for a %s server",
    (status) => {
      expect(agentMcpServerSignInCommand("claudeCode", { name: "docs", status })).toBeNull();
    },
  );
});
