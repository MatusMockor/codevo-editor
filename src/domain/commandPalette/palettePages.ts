export const PALETTE_PAGE_IDS = [
  "root",
  "files",
  "newThreadIn",
  "switchProject",
  "runScript",
  "switchBranch",
  "changeModel",
  "theme",
  "appearance",
  "shortcuts",
] as const;
export type PalettePageId = (typeof PALETTE_PAGE_IDS)[number];
export type PaletteSurface = "commands" | "files";

export interface PalettePageCopy {
  readonly placeholder: string;
  readonly enterLabel: string | null;
  readonly empty: string;
}

const SUB_PAGE_COPY: PalettePageCopy = {
  placeholder: "Search…",
  enterLabel: null,
  empty: "No matches.",
};

export function isPalettePageId(value: unknown): value is PalettePageId {
  return PALETTE_PAGE_IDS.some((page) => page === value);
}

export function paletteSurfaceForPage(page: PalettePageId): PaletteSurface {
  if (page === "files") return "files";
  return "commands";
}

export function palettePageCopy(page: PalettePageId, actionsOnly: boolean): PalettePageCopy {
  switch (page) {
    case "root":
      return {
        placeholder: "Search commands, projects, threads, and files…",
        enterLabel: null,
        empty: actionsOnly
          ? "No matching actions."
          : "No matching commands, projects, threads, or files.",
      };
    case "files":
      return { placeholder: "Search files…", enterLabel: "Open file", empty: "No matching files." };
    case "changeModel":
      return { placeholder: "Search models…", enterLabel: null, empty: "No matching models." };
    case "shortcuts":
      return {
        placeholder: "Search shortcuts…",
        enterLabel: "Run",
        empty: "No matching shortcuts.",
      };
    case "newThreadIn":
    case "switchProject":
    case "runScript":
    case "switchBranch":
    case "theme":
    case "appearance":
      return SUB_PAGE_COPY;
    default:
      return unreachablePage(page);
  }
}

function unreachablePage(page: never): never {
  return page;
}
