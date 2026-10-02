// @vitest-environment jsdom
import { act, type MouseEvent } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AgentLocalFileOpenOutcome } from "../../domain/agentMarkdown/agentLocalFileLinkFailure";
import { parseAgentMarkdownLink } from "../../domain/agentMarkdown/agentMarkdownLink";
import {
  agentLocalFileLinkScope,
  type AgentLocalFileLinkPort,
  type AgentLocalFileLinkScope,
} from "./agentMarkdownLinks";
import {
  MAX_REMEMBERED_UNAVAILABLE_LINKS,
  useAgentMarkdownLinkActivation,
  type AgentMarkdownLinkActivationState,
} from "./useAgentMarkdownLinkActivation";

const ROOT = "/workspace/app";

let host: HTMLDivElement;
let root: Root;
let state: AgentMarkdownLinkActivationState | null = null;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  state = null;
});

function Probe({ scope }: { readonly scope: AgentLocalFileLinkScope | null }) {
  state = useAgentMarkdownLinkActivation(async () => undefined, scope);
  return null;
}

function scopeFor(port: AgentLocalFileLinkPort): AgentLocalFileLinkScope | null {
  return agentLocalFileLinkScope(port, { repositoryRoot: ROOT, worktreePath: null });
}

function click(href: string): void {
  const anchor = document.createElement("a");
  host.append(anchor);
  const event = {
    button: 0,
    currentTarget: anchor,
    target: anchor,
    preventDefault: vi.fn(),
  } as unknown as MouseEvent<HTMLAnchorElement>;
  state?.activateLink(event, parseAgentMarkdownLink(href));
}

function deferredPort() {
  const pending: Array<(outcome: AgentLocalFileOpenOutcome) => void> = [];
  const report = vi.fn<AgentLocalFileLinkPort["report"]>();
  const port: AgentLocalFileLinkPort = {
    open: () => new Promise((resolve) => pending.push(resolve)),
    report,
  };
  return { port, pending, report };
}

it("marks a failed link for this message and forgets it when the scope changes", async () => {
  const first = deferredPort();
  const scope = scopeFor(first.port);
  act(() => root.render(<Probe scope={scope} />));

  click("src/gone.ts");
  await act(async () => first.pending[0]?.("notFound"));
  expect(state?.unavailableLinks?.get("relative:src/gone.ts")?.kind).toBe("notFound");

  const second = deferredPort();
  act(() => root.render(<Probe scope={scopeFor(second.port)} />));
  expect(state?.unavailableLinks).toBeNull();
});

it("ignores a failure that settles after the scope was replaced", async () => {
  const first = deferredPort();
  act(() => root.render(<Probe scope={scopeFor(first.port)} />));
  click("src/late.ts");

  const second = deferredPort();
  act(() => root.render(<Probe scope={scopeFor(second.port)} />));
  await act(async () => first.pending[0]?.("notFound"));

  expect(state?.unavailableLinks).toBeNull();
});

it("keeps at most a bounded number of remembered failures", async () => {
  const deferred = deferredPort();
  act(() => root.render(<Probe scope={scopeFor(deferred.port)} />));
  for (let index = 0; index <= MAX_REMEMBERED_UNAVAILABLE_LINKS; index += 1) {
    click(`src/gone-${index}.ts`);
    await act(async () => deferred.pending[index]?.("notFound"));
  }
  expect(state?.unavailableLinks?.size).toBe(MAX_REMEMBERED_UNAVAILABLE_LINKS);
  expect(state?.unavailableLinks?.has("relative:src/gone-0.ts")).toBe(false);
});
