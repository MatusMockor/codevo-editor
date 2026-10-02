import type { RemotePortPreviewEntry } from "../../application/remotePortPreviewState";
import type { RemoteLoopbackScheme, RemotePortForwardView } from "../../domain/remotePortPreview";
import type { RemotePortSource } from "../../domain/remotePortPreviewWire";

export const REMOTE_PORTS_AGENT_LIFETIME_NOTE =
  "Servers started by the agent stop when the turn ends. Use the server Terminal to keep one running.";

export type RemotePortRow = Readonly<{
  port: number;
  process: string;
  sources: readonly RemotePortSource[];
  forward: RemotePortForwardView;
}>;

export function remotePortRows(entries: readonly RemotePortPreviewEntry[]): RemotePortRow[] {
  const rows = new Map<number, RemotePortRow>();
  for (const entry of entries) {
    const row = rows.get(entry.port);
    if (row === undefined) {
      rows.set(entry.port, {
        port: entry.port,
        process: entry.process,
        sources: [entry.source],
        forward: entry.forward,
      });
      continue;
    }
    if (row.sources.includes(entry.source)) continue;
    rows.set(entry.port, { ...row, sources: [...row.sources, entry.source] });
  }
  return [...rows.values()];
}

export const remotePortLocalUrl = (localPort: number, scheme: RemoteLoopbackScheme): string =>
  `${scheme}://127.0.0.1:${localPort}/`;
