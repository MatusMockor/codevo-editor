// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { AgentTasksNotice } from "../../application/agentThreadPorts";
import {
  agentLocalFileLinkFailure,
  agentLocalFileLinkPlace,
} from "../../domain/agentMarkdown/agentLocalFileLinkFailure";
import type { AgentLocalFileLinkPort } from "./agentMarkdownLinks";
import { useAgentLocalFileLinks, type AgentFileLocationOpener } from "./useAgentLocalFileLinks";

const EDITOR = agentLocalFileLinkPlace("project", "/Users/me/Developer/editor");

const REQUEST = {
  location: { path: "/workspace/app/src/a.ts", line: 3, column: null },
  root: "/workspace/app",
};

function probe(
  opener: AgentFileLocationOpener | undefined,
  notices: AgentTasksNotice[],
): { port: AgentLocalFileLinkPort | null; unmount: () => void } {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(document.createElement("div"));
  const captured: { port: AgentLocalFileLinkPort | null } = { port: null };
  function Probe() {
    captured.port = useAgentLocalFileLinks(opener, (notice) => notices.push(notice));
    return null;
  }
  act(() => root.render(<Probe />));
  return { port: captured.port, unmount: () => act(() => root.unmount()) };
}

it("has no port without an editor opener", () => {
  const view = probe(undefined, []);
  expect(view.port).toBeNull();
  view.unmount();
});

it("passes the open outcome through without reporting anything itself", async () => {
  const notices: AgentTasksNotice[] = [];
  const opener = vi.fn<AgentFileLocationOpener>().mockResolvedValueOnce("notFound");
  const view = probe(opener, notices);

  await expect(view.port?.open(REQUEST)).resolves.toBe("notFound");
  expect(opener).toHaveBeenCalledExactlyOnceWith(REQUEST);
  expect(notices).toEqual([]);
  view.unmount();
});

it("reports each failure as a calm, specific, dismissible notice", () => {
  const notices: AgentTasksNotice[] = [];
  const view = probe(vi.fn<AgentFileLocationOpener>(), notices);

  act(() => view.port?.report(agentLocalFileLinkFailure("notFound", "src/env.ts", EDITOR)));
  act(() => view.port?.report(agentLocalFileLinkFailure("outsideProject", "/etc/hosts", EDITOR)));
  act(() => view.port?.report(agentLocalFileLinkFailure("unreadable", "src/key.pem", EDITOR)));
  act(() => view.port?.report(agentLocalFileLinkFailure("remoteThread", "src/a.ts", null)));

  expect(notices).toEqual([
    { kind: "info", message: "src/env.ts isn't in this project (editor).", action: null },
    {
      kind: "info",
      message: "/etc/hosts is outside this project (editor), so it wasn't opened.",
      action: null,
    },
    { kind: "info", message: "src/key.pem exists but couldn't be read.", action: null },
    { kind: "info", message: "File links are not available for remote threads.", action: null },
  ]);
  view.unmount();
});
