// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { AgentTasksNotice } from "../../application/agentThreadPorts";
import {
  AGENT_LOCAL_FILE_LINK_BLOCKED_NOTICE,
  AGENT_LOCAL_FILE_LINK_FAILED_NOTICE,
  AGENT_LOCAL_FILE_LINK_REMOTE_NOTICE,
  type AgentLocalFileLinkPort,
} from "./agentMarkdownLinks";
import { useAgentLocalFileLinks, type AgentFileLocationOpener } from "./useAgentLocalFileLinks";

const LOCATION = { path: "/workspace/app/src/a.ts", line: 3, column: null };

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

it("opens through the editor opener and reports rejections and failed opens", async () => {
  const notices: AgentTasksNotice[] = [];
  const opener = vi.fn<AgentFileLocationOpener>().mockResolvedValueOnce(true);
  opener.mockResolvedValueOnce(false).mockRejectedValueOnce(new Error("gone"));
  const view = probe(opener, notices);
  expect(view.port).not.toBeNull();

  await act(async () => view.port?.open(LOCATION));
  expect(opener).toHaveBeenCalledWith(LOCATION);
  expect(notices).toEqual([]);

  await act(async () => view.port?.open(LOCATION));
  await act(async () => view.port?.open(LOCATION));
  expect(notices).toEqual([
    AGENT_LOCAL_FILE_LINK_FAILED_NOTICE,
    AGENT_LOCAL_FILE_LINK_FAILED_NOTICE,
  ]);

  act(() => view.port?.reject("outsideRoots"));
  expect(notices[notices.length - 1]).toEqual(AGENT_LOCAL_FILE_LINK_BLOCKED_NOTICE);
  act(() => view.port?.reject("remoteThread"));
  expect(notices[notices.length - 1]).toEqual(AGENT_LOCAL_FILE_LINK_REMOTE_NOTICE);
  expect(AGENT_LOCAL_FILE_LINK_REMOTE_NOTICE.message).toBe(
    "File links are not available for remote threads.",
  );
  view.unmount();
});
