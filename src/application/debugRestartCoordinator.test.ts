import { describe, expect, it } from "vitest";
import type { DebugLaunchTarget, DebuggerState } from "../domain/debug";
import {
  DebugRestartCoordinator,
  MAX_DEBUG_RESTART_ARGUMENTS,
  MAX_DEBUG_RESTART_ENVIRONMENT_ENTRIES,
  MAX_DEBUG_RESTART_PATH_BYTES,
  MAX_DEBUG_RESTART_ROOT_BYTES,
} from "./debugRestartCoordinator";

const ROOT = "/workspace/project";
const SESSION = 7;

describe("DebugRestartCoordinator retention", () => {
  it.each<DebugLaunchTarget>([
    { kind: "node-attach", port: 9229 },
    { kind: "node-script", scriptPath: `${ROOT}/server.js` },
    {
      filePath: `${ROOT}/a.test.ts`,
      kind: "js-test-file",
      packageRootPath: ROOT,
      runner: "vitest",
    },
    {
      filePath: `${ROOT}/a.test.ts`,
      kind: "js-test-selection",
      packageRootPath: ROOT,
      runner: "jest",
      selection: { fullName: "suite works", kind: "test", nameMatch: "exact" },
    },
    {
      args: ["--inspect"],
      env: { TOKEN: "private" },
      justMyCode: "nodeInternals",
      kind: "node-configured-script",
      scriptPath: `${ROOT}/server.js`,
      sourceMaps: false,
    },
    {
      args: ["--runInBand"],
      cwd: ROOT,
      env: { TOKEN: "private" },
      filePath: `${ROOT}/a.test.ts`,
      kind: "js-configured-test",
      packageRootPath: ROOT,
      runner: "jest",
    },
    {
      args: ["--watch=false"],
      env: { TOKEN: "private" },
      justMyCode: "nodeInternals",
      kind: "node-npm-script",
      packageRootPath: ROOT,
      script: "dev",
    },
  ])("retains and resolves the Node launch kind $kind", (launch) => {
    const coordinator = new DebugRestartCoordinator();
    expect(coordinator.retain(`${ROOT}/`, SESSION, launch)).toBe(true);
    const availability = coordinator.availability(eligible());
    expect(availability).toEqual({
      canRestart: true,
      rootKey: ROOT,
      sessionId: SESSION,
      targetKind: launch.kind,
    });
    expect(Object.isFrozen(availability)).toBe(true);
    const attempt = coordinator.begin(eligible())!;
    const resolved = coordinator.resolve(attempt, current());
    expect(resolved).toEqual(launch);
    expect(Object.isFrozen(resolved)).toBe(true);
  });

  it("preserves an explicit source-map disable across a restart lease", () => {
    const coordinator = new DebugRestartCoordinator();
    const launch: DebugLaunchTarget = {
      args: [],
      env: {},
      kind: "node-configured-script",
      scriptPath: `${ROOT}/server.ts`,
      sourceMaps: false,
    };

    expect(coordinator.retain(ROOT, SESSION, launch)).toBe(true);
    const resolved = coordinator.resolve(coordinator.begin(eligible())!, current());

    expect(resolved).toEqual(launch);
  });

  it("rejects sourceMaps on JavaScript test launch kinds before retention", () => {
    const coordinator = new DebugRestartCoordinator();
    const launch = {
      filePath: `${ROOT}/a.test.ts`,
      kind: "js-test-file",
      packageRootPath: ROOT,
      runner: "vitest",
      sourceMaps: false,
    } as unknown as DebugLaunchTarget;

    expect(coordinator.retain(ROOT, SESSION, launch)).toBe(false);
  });

  it("never exposes private args or env in the UI-safe availability or attempt", () => {
    const coordinator = new DebugRestartCoordinator();
    coordinator.retain(ROOT, SESSION, configuredLaunch());
    const availability = coordinator.availability(eligible());
    const attempt = coordinator.begin(eligible())!;
    for (const value of [availability, attempt]) {
      const serialized = JSON.stringify(value);
      expect(serialized).not.toContain("private-token");
      expect(serialized).not.toContain("--secret");
      expect(serialized).not.toContain('"env"');
      expect(serialized).not.toContain('"args"');
      expect(serialized).not.toContain("nodeInternals");
      expect(Object.isFrozen(value)).toBe(true);
    }
  });

  it("defensively clones both retained input and resolved output", () => {
    const args = ["--secret"];
    const env = { TOKEN: "private-token" };
    const launch: DebugLaunchTarget = {
      args,
      env,
      kind: "node-configured-script",
      scriptPath: `${ROOT}/server.js`,
    };
    const coordinator = new DebugRestartCoordinator();
    coordinator.retain(ROOT, SESSION, launch);
    args[0] = "mutated";
    env.TOKEN = "mutated";
    const first = coordinator.resolve(coordinator.begin(eligible())!, current())!;
    expect(first).toMatchObject({ args: ["--secret"], env: { TOKEN: "private-token" } });
    expect(() => ((first as typeof launch).args[0] = "again")).toThrow();
    const second = coordinator.resolve(coordinator.begin(eligible())!, current());
    expect(second).toMatchObject({ args: ["--secret"], env: { TOKEN: "private-token" } });
  });

  it("retains the private Node-internals policy across a restart lease", () => {
    const coordinator = new DebugRestartCoordinator();
    expect(
      coordinator.retain(ROOT, SESSION, {
        args: [],
        env: {},
        justMyCode: "nodeInternals",
        kind: "node-configured-script",
        scriptPath: `${ROOT}/server.js`,
      }),
    ).toBe(true);

    const attempt = coordinator.begin(eligible())!;
    expect(JSON.stringify(attempt)).not.toContain("nodeInternals");
    expect(coordinator.resolve(attempt, current())).toEqual({
      args: [],
      env: {},
      justMyCode: "nodeInternals",
      kind: "node-configured-script",
      scriptPath: `${ROOT}/server.js`,
    });
  });

  it.each(["dependencies", "nodeInternalsAndDependencies"] as const)(
    "retains the closed %s policy across a restart lease",
    (justMyCode) => {
      const coordinator = new DebugRestartCoordinator();
      expect(
        coordinator.retain(ROOT, SESSION, {
          args: [],
          env: {},
          justMyCode,
          kind: "node-configured-script",
          scriptPath: `${ROOT}/server.js`,
        }),
      ).toBe(true);

      const attempt = coordinator.begin(eligible())!;
      expect(JSON.stringify(attempt)).not.toContain(justMyCode);
      expect(coordinator.resolve(attempt, current())).toMatchObject({ justMyCode });
    },
  );

  it.each([
    {
      args: [],
      env: {},
      justMyCode: "nodeModules",
      kind: "node-configured-script",
      scriptPath: `${ROOT}/server.js`,
    },
    {
      args: [],
      env: {},
      justMyCode: "<node_internals>/**",
      kind: "node-npm-script",
      packageRootPath: ROOT,
      script: "dev",
    },
    { justMyCode: "nodeInternals", kind: "node-attach", port: 9229 },
  ])("rejects malformed or unsupported runtime Just My Code policy %#", (launch) => {
    const coordinator = retainedCoordinator();
    expect(coordinator.retain(ROOT, SESSION + 1, launch as unknown as DebugLaunchTarget)).toBe(
      false,
    );
    expect(coordinator.availability(eligible()).canRestart).toBe(false);
  });

  it.each<DebugLaunchTarget>([
    { kind: "php-script", scriptPath: `${ROOT}/index.php` },
    { kind: "php-test-file", filePath: `${ROOT}/IndexTest.php` },
    { kind: "php-listen" },
  ])("rejects non-Node target $kind and clears prior retention", (launch) => {
    const coordinator = retainedCoordinator();
    expect(coordinator.retain(ROOT, 8, launch)).toBe(false);
    expect(coordinator.availability(eligible())).toMatchObject({ canRestart: false });
  });

  it.each([
    null,
    undefined,
    {},
    {
      kind: "js-test-selection",
      filePath: `${ROOT}/a.test.ts`,
      packageRootPath: ROOT,
      runner: "jest",
    },
    {
      kind: "js-test-selection",
      filePath: `${ROOT}/a.test.ts`,
      packageRootPath: ROOT,
      runner: "jest",
      selection: null,
    },
  ])("fails closed for malformed runtime launch value %#", (launch) => {
    const coordinator = retainedCoordinator();
    expect(() =>
      coordinator.retain(ROOT, SESSION + 1, launch as unknown as DebugLaunchTarget),
    ).not.toThrow();
    expect(coordinator.availability(eligible({ sessionId: SESSION + 1 })).canRestart).toBe(false);
    expect(coordinator.availability(eligible()).canRestart).toBe(false);
  });
});

describe("DebugRestartCoordinator eligibility", () => {
  it.each<DebuggerState["kind"]>(["inactive", "starting", "terminated"])(
    "rejects debugger state %s",
    (stateKind) => {
      expect(retainedCoordinator().availability(eligible({ stateKind })).canRestart).toBe(false);
    },
  );

  it("requires trust plus the exact normalized root and positive session", () => {
    const coordinator = retainedCoordinator();
    expect(coordinator.availability(eligible({ workspaceTrusted: false })).canRestart).toBe(false);
    expect(coordinator.availability(eligible({ rootPath: "/other" })).canRestart).toBe(false);
    expect(coordinator.availability(eligible({ sessionId: SESSION + 1 })).canRestart).toBe(false);
    expect(coordinator.availability(eligible({ sessionId: 0 })).canRestart).toBe(false);
    expect(coordinator.availability(eligible({ rootPath: `${ROOT}/` })).canRestart).toBe(true);
    expect(coordinator.availability(eligible({ stateKind: "stopped" })).canRestart).toBe(true);
  });

  it("allows only one pending attempt and cancel restores eligibility", () => {
    const coordinator = retainedCoordinator();
    const attempt = coordinator.begin(eligible())!;
    expect(coordinator.begin(eligible())).toBeNull();
    expect(coordinator.availability(eligible()).canRestart).toBe(false);
    expect(coordinator.cancel({ ...attempt })).toBe(false);
    expect(coordinator.cancel(attempt)).toBe(true);
    expect(coordinator.availability(eligible()).canRestart).toBe(true);
  });
});

describe("DebugRestartCoordinator stale attempt policy", () => {
  it.each([
    ["root switch", { rootPath: "/other", sessionId: SESSION, workspaceTrusted: true }],
    ["session replacement", { rootPath: ROOT, sessionId: SESSION + 1, workspaceTrusted: true }],
    ["trust loss", { rootPath: ROOT, sessionId: SESSION, workspaceTrusted: false }],
  ] as const)("consumes without resolving after %s", (_label, context) => {
    const coordinator = retainedCoordinator();
    const attempt = coordinator.begin(eligible())!;
    expect(coordinator.resolve(attempt, context)).toBeNull();
    expect(coordinator.resolve(attempt, current())).toBeNull();
  });

  it("rejects a superseded attempt after a newer session is retained", () => {
    const coordinator = retainedCoordinator();
    const stale = coordinator.begin(eligible())!;
    coordinator.retain(ROOT, SESSION + 1, { kind: "node-script", scriptPath: `${ROOT}/new.js` });
    expect(coordinator.resolve(stale, current())).toBeNull();
    expect(coordinator.availability(eligible({ sessionId: SESSION + 1 })).targetKind).toBe(
      "node-script",
    );
  });

  it("rejects forged and already-consumed leases", () => {
    const coordinator = retainedCoordinator();
    const attempt = coordinator.begin(eligible())!;
    expect(coordinator.resolve({ ...attempt }, current())).toBeNull();
    expect(coordinator.resolve(attempt, current())).toEqual(configuredLaunch());
    expect(coordinator.resolve(attempt, current())).toBeNull();
  });

  it("releases only an exact retained owner", () => {
    const coordinator = retainedCoordinator();
    expect(coordinator.release("/other", SESSION)).toBe(false);
    expect(coordinator.release(ROOT, SESSION + 1)).toBe(false);
    expect(coordinator.release(`${ROOT}/`, SESSION)).toBe(true);
    expect(coordinator.availability(eligible()).canRestart).toBe(false);
  });

  it("keeps a private in-flight replay lease after exact termination releases the live owner", () => {
    const coordinator = retainedCoordinator();
    const attempt = coordinator.begin(eligible())!;
    expect(coordinator.release(ROOT, SESSION)).toBe(true);
    expect(coordinator.availability(eligible()).canRestart).toBe(false);
    expect(coordinator.resolve(attempt, current())).toEqual(configuredLaunch());
    expect(coordinator.resolve(attempt, current())).toBeNull();
  });
});

describe("DebugRestartCoordinator defensive bounds", () => {
  it("rejects invalid roots, sessions, paths, ports, arguments, and environments", () => {
    const invalid: Array<[string, number, DebugLaunchTarget]> = [
      ["relative", SESSION, { kind: "node-script", scriptPath: `${ROOT}/a.js` }],
      [
        `/${"r".repeat(MAX_DEBUG_RESTART_ROOT_BYTES)}`,
        SESSION,
        { kind: "node-script", scriptPath: `${ROOT}/a.js` },
      ],
      [ROOT, 0, { kind: "node-script", scriptPath: `${ROOT}/a.js` }],
      [ROOT, SESSION, { kind: "node-attach", port: 70_000 }],
      [
        ROOT,
        SESSION,
        { kind: "node-script", scriptPath: "x".repeat(MAX_DEBUG_RESTART_PATH_BYTES + 1) },
      ],
      [
        ROOT,
        SESSION,
        { ...configuredLaunch(), args: Array(MAX_DEBUG_RESTART_ARGUMENTS + 1).fill("x") },
      ],
      [
        ROOT,
        SESSION,
        {
          ...configuredLaunch(),
          env: Object.fromEntries(
            Array.from({ length: MAX_DEBUG_RESTART_ENVIRONMENT_ENTRIES + 1 }, (_, index) => [
              `KEY_${index}`,
              "x",
            ]),
          ),
        },
      ],
    ];
    for (const [root, sessionId, launch] of invalid) {
      const coordinator = new DebugRestartCoordinator();
      expect(coordinator.retain(root, sessionId, launch)).toBe(false);
      expect(coordinator.availability(eligible()).canRestart).toBe(false);
    }
  });

  it.each(["\n", "\u2028", "\u2029", "\u202e", "\u2066"])(
    "rejects unsafe path character %j across path-bearing launch fields",
    (unsafeCharacter) => {
      const unsafePath = `${ROOT}/${unsafeCharacter}hidden.js`;
      const launches: DebugLaunchTarget[] = [
        { kind: "node-script", scriptPath: unsafePath },
        {
          filePath: unsafePath,
          kind: "js-test-file",
          packageRootPath: ROOT,
          runner: "vitest",
        },
        {
          filePath: `${ROOT}/a.test.ts`,
          kind: "js-test-selection",
          packageRootPath: unsafePath,
          runner: "jest",
          selection: { kind: "file" },
        },
        {
          args: [],
          cwd: unsafePath,
          env: {},
          kind: "node-configured-script",
          scriptPath: `${ROOT}/server.js`,
        },
        {
          args: [],
          env: {},
          kind: "node-npm-script",
          packageRootPath: unsafePath,
          script: "dev",
        },
      ];

      for (const launch of launches) {
        const coordinator = retainedCoordinator();
        expect(coordinator.retain(ROOT, SESSION + 1, launch)).toBe(false);
        expect(coordinator.availability(eligible()).canRestart).toBe(false);
      }
    },
  );
});

function configuredLaunch(): Extract<DebugLaunchTarget, { kind: "node-configured-script" }> {
  return {
    args: ["--secret"],
    env: { TOKEN: "private-token" },
    kind: "node-configured-script",
    scriptPath: `${ROOT}/server.js`,
  };
}

function retainedCoordinator(): DebugRestartCoordinator {
  const coordinator = new DebugRestartCoordinator();
  expect(coordinator.retain(ROOT, SESSION, configuredLaunch())).toBe(true);
  return coordinator;
}

function eligible(overrides: Partial<Parameters<DebugRestartCoordinator["availability"]>[0]> = {}) {
  return {
    rootPath: ROOT,
    sessionId: SESSION,
    stateKind: "running" as const,
    workspaceTrusted: true,
    ...overrides,
  };
}

function current(overrides: Partial<Parameters<DebugRestartCoordinator["resolve"]>[1]> = {}) {
  return { rootPath: ROOT, sessionId: SESSION, workspaceTrusted: true, ...overrides };
}
