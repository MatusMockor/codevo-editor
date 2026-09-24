import { useEffect, useRef, useState } from "react";
import type { PaletteBranchesView, PaletteBranchSource } from "./commandPaletteProvider";

const MAX_ERROR_CHARS = 300;

export interface PaletteBranchesOptions {
  readonly source: PaletteBranchSource | null;
  readonly enabled: boolean;
  readonly unavailableReason: string;
}

export function usePaletteBranches({
  enabled,
  source,
  unavailableReason,
}: PaletteBranchesOptions): PaletteBranchesView {
  const [loaded, setLoaded] = useState<{
    source: PaletteBranchSource;
    view: PaletteBranchesView;
  } | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    generation.current += 1;
    const owned = generation.current;
    if (!enabled || source === null) return;
    void source
      .load()
      .then((branches) => {
        if (generation.current !== owned) return;
        setLoaded({ source, view: { status: "ready", scopeLabel: source.scopeLabel, branches } });
      })
      .catch((error: unknown) => {
        if (generation.current !== owned) return;
        setLoaded({ source, view: { status: "error", message: boundedMessage(error) } });
      });
  }, [enabled, source]);

  if (source === null) return { status: "unavailable", reason: unavailableReason };
  if (!enabled) return { status: "idle" };
  if (loaded === null || loaded.source !== source) return { status: "loading" };
  return loaded.view;
}

function boundedMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : "Could not load branches.";
  const clean = raw.replace(/[\x00-\x1f\x7f]/g, " ").trim();
  if (clean === "") return "Could not load branches.";
  return clean.slice(0, MAX_ERROR_CHARS);
}
