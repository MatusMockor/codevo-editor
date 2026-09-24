import { useEffect, useRef, useState } from "react";
import { parsePaletteRootQuery } from "../../domain/commandPalette/paletteRootQuery";
import type { FileSearchGateway, FileSearchResult } from "../../domain/workspace";

const ROOT_FILE_LIMIT = 5;
const ROOT_FILE_DEBOUNCE_MS = 80;
const EMPTY: readonly FileSearchResult[] = [];

export interface PaletteRootFilesOptions {
  readonly gateway: FileSearchGateway;
  readonly root: string | null;
  readonly query: string;
  readonly enabled: boolean;
}

type RootFileRun = () => Promise<void>;

interface RootFileFlight {
  running: boolean;
  queued: RootFileRun | null;
}

export function usePaletteRootFiles({
  enabled,
  gateway,
  query,
  root,
}: PaletteRootFilesOptions): readonly FileSearchResult[] {
  const [result, setResult] = useState<{ key: string; files: readonly FileSearchResult[] }>({
    key: "",
    files: EMPTY,
  });
  const generation = useRef(0);
  const flight = useRef<RootFileFlight>({ running: false, queued: null });
  const parsed = parsePaletteRootQuery(query);
  const text = parsed.kind === "search" ? parsed.text.trim() : "";
  const key = JSON.stringify([root, text]);

  useEffect(() => {
    generation.current += 1;
    const owned = generation.current;
    const slot = flight.current;
    if (!enabled || root === null || text === "") return undefined;
    const run: RootFileRun = async () => {
      if (generation.current !== owned) return;
      try {
        const files = await searchRootFiles(gateway, root, text, owned);
        if (generation.current !== owned) return;
        setResult({ key, files: files.slice(0, ROOT_FILE_LIMIT) });
      } catch {
        if (generation.current !== owned) return;
        setResult({ key, files: EMPTY });
      }
    };
    const timer = window.setTimeout(() => submitRootFileRun(slot, run), ROOT_FILE_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      if (slot.queued === run) slot.queued = null;
    };
  }, [enabled, gateway, key, root, text]);

  if (result.key !== key) return EMPTY;
  return result.files;
}

function searchRootFiles(
  gateway: FileSearchGateway,
  root: string,
  text: string,
  owned: number,
): Promise<readonly FileSearchResult[]> {
  if (gateway.searchFilesWithMetadata === undefined) {
    return gateway.searchFiles(root, text, ROOT_FILE_LIMIT);
  }
  return gateway
    .searchFilesWithMetadata(root, text, ROOT_FILE_LIMIT, `palette-${owned}`)
    .then((response) => response.results);
}

function submitRootFileRun(slot: RootFileFlight, run: RootFileRun): void {
  if (slot.running) {
    slot.queued = run;
    return;
  }
  startRootFileRun(slot, run);
}

function startRootFileRun(slot: RootFileFlight, run: RootFileRun): void {
  slot.running = true;
  void run().finally(() => {
    slot.running = false;
    const next = slot.queued;
    slot.queued = null;
    if (next !== null) startRootFileRun(slot, next);
  });
}
