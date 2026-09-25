// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { RepositoryHostsSnapshot } from "../domain/repositoryLookup";
import type { RepositoryLookupGateway } from "./repositoryLookupPorts";
import {
  repositoryHostStatuses,
  useRepositoryHostStatus,
  type RepositoryHostStatuses,
} from "./useRepositoryHostStatus";

describe("repositoryHostStatuses", () => {
  it("prefers an authenticated host and maps missing CLIs and failures", () => {
    expect(
      repositoryHostStatuses({
        github: {
          status: "ready",
          truncated: false,
          hosts: [
            { provider: "github", host: "ghe.example.com", auth: "notAuthenticated" },
            { provider: "github", host: "github.com", auth: "authenticated" },
          ],
        },
        gitlab: { status: "cliMissing" },
      }),
    ).toEqual({ github: { kind: "ready", host: "github.com" }, gitlab: { kind: "missing" } });
    expect(
      repositoryHostStatuses({
        github: {
          status: "ready",
          truncated: false,
          hosts: [{ provider: "github", host: "github.com", auth: "notAuthenticated" }],
        },
        gitlab: { status: "failed", reason: "timedOut" },
      }),
    ).toEqual({
      github: { kind: "signedOut", host: "github.com" },
      gitlab: { kind: "unavailable" },
    });
    expect(
      repositoryHostStatuses({
        github: { status: "ready", truncated: false, hosts: [] },
        gitlab: { status: "cliMissing" },
      }).github,
    ).toEqual({ kind: "missing" });
  });
});

describe("useRepositoryHostStatus", () => {
  const snapshot: RepositoryHostsSnapshot = {
    github: {
      status: "ready",
      truncated: false,
      hosts: [{ provider: "github", host: "github.com", auth: "authenticated" }],
    },
    gitlab: { status: "cliMissing" },
  };

  function render(gateway: RepositoryLookupGateway | null, enabled: boolean) {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const result: { current: RepositoryHostStatuses | null } = { current: null };
    function Harness(props: {
      readonly gateway: RepositoryLookupGateway | null;
      readonly enabled: boolean;
    }) {
      result.current = useRepositoryHostStatus(props.gateway, props.enabled);
      return null;
    }
    const root = createRoot(document.createElement("div"));
    const update = (next: RepositoryLookupGateway | null, nextEnabled: boolean) =>
      act(() => root.render(createElement(Harness, { gateway: next, enabled: nextEnabled })));
    update(gateway, enabled);
    return { result, update, unmount: () => act(() => root.unmount()) };
  }

  it("loads hosts only while enabled and reports checking until the answer arrives", async () => {
    const gateway: RepositoryLookupGateway = {
      listHosts: vi.fn(async () => snapshot),
      lookup: vi.fn(),
    };
    const hook = render(gateway, false);
    expect(gateway.listHosts).not.toHaveBeenCalled();
    expect(hook.result.current?.github).toEqual({ kind: "checking" });
    await act(async () => hook.update(gateway, true));
    expect(gateway.listHosts).toHaveBeenCalledTimes(1);
    expect(hook.result.current).toEqual({
      github: { kind: "ready", host: "github.com" },
      gitlab: { kind: "missing" },
    });
    hook.unmount();
  });

  it("reports unavailable without a gateway or when listing fails, and ignores a replaced gateway", async () => {
    const hook = render(null, true);
    expect(hook.result.current).toEqual({
      github: { kind: "unavailable" },
      gitlab: { kind: "unavailable" },
    });
    let release: (value: RepositoryHostsSnapshot) => void = () => undefined;
    const slow: RepositoryLookupGateway = {
      listHosts: vi.fn(
        () =>
          new Promise<RepositoryHostsSnapshot>((resolve) => {
            release = resolve;
          }),
      ),
      lookup: vi.fn(),
    };
    const failing: RepositoryLookupGateway = {
      listHosts: vi.fn(async () => Promise.reject(new Error("offline"))),
      lookup: vi.fn(),
    };
    await act(async () => hook.update(slow, true));
    await act(async () => hook.update(failing, true));
    await act(async () => release(snapshot));
    expect(hook.result.current).toEqual({
      github: { kind: "unavailable" },
      gitlab: { kind: "unavailable" },
    });
    hook.unmount();
  });
});
