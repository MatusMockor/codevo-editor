import { MAX_PALETTE_QUERY_CHARS } from "./paletteMatch";
import type { PalettePageId } from "./palettePages";

const MAX_PALETTE_DEPTH = 4;

export interface PaletteNavigationState {
  readonly stack: readonly PalettePageId[];
  readonly query: string;
  readonly generation: number;
}

export type PaletteNavigationAction =
  | { readonly type: "open"; readonly page: PalettePageId; readonly query: string }
  | { readonly type: "push"; readonly page: PalettePageId }
  | { readonly type: "pop" }
  | { readonly type: "setQuery"; readonly query: string };

export const INITIAL_PALETTE_NAVIGATION: PaletteNavigationState = {
  stack: ["root"],
  query: "",
  generation: 0,
};

export function currentPalettePage(state: PaletteNavigationState): PalettePageId {
  return state.stack[state.stack.length - 1] ?? "root";
}

export function reducePaletteNavigation(
  state: PaletteNavigationState,
  action: PaletteNavigationAction,
): PaletteNavigationState {
  switch (action.type) {
    case "open":
      return {
        stack: openedStack(action.page),
        query: bounded(action.query),
        generation: state.generation + 1,
      };
    case "push":
      if (currentPalettePage(state) === action.page) return state;
      if (state.stack.length >= MAX_PALETTE_DEPTH) return state;
      return { stack: [...state.stack, action.page], query: "", generation: state.generation + 1 };
    case "pop":
      if (state.stack.length <= 1) return state;
      return { stack: state.stack.slice(0, -1), query: "", generation: state.generation + 1 };
    case "setQuery":
      return { ...state, query: bounded(action.query) };
    default:
      return unreachableAction(action);
  }
}

function openedStack(page: PalettePageId): readonly PalettePageId[] {
  if (page === "root" || page === "files") return [page];
  return ["root", page];
}

function bounded(query: string): string {
  return query.slice(0, MAX_PALETTE_QUERY_CHARS);
}

function unreachableAction(action: never): never {
  return action;
}
