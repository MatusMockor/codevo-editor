import type {
  LanguageServerRange,
  LanguageServerTypeHierarchyItem,
} from "./languageServerFeatures";

export interface TypeHierarchyView {
  item: LanguageServerTypeHierarchyItem;
  subtypes: LanguageServerTypeHierarchyItem[];
  supertypes: LanguageServerTypeHierarchyItem[];
}

export type TypeHierarchyDirection = "supertype" | "subtype";

export interface TypeHierarchyRow {
  detail: string;
  direction: TypeHierarchyDirection;
  id: string;
  item: LanguageServerTypeHierarchyItem;
  kindLabel: string;
  label: string;
  range: LanguageServerRange;
}

export function typeHierarchyRows(view: TypeHierarchyView): TypeHierarchyRow[] {
  return [
    ...view.supertypes.map((item, index) =>
      typeHierarchyRow("supertype", item, index),
    ),
    ...view.subtypes.map((item, index) =>
      typeHierarchyRow("subtype", item, index),
    ),
  ];
}

export function typeHierarchySectionTitle(
  direction: TypeHierarchyDirection,
): string {
  return direction === "supertype" ? "Supertypes" : "Subtypes";
}

function typeHierarchyRow(
  direction: TypeHierarchyDirection,
  item: LanguageServerTypeHierarchyItem,
  index: number,
): TypeHierarchyRow {
  const range = item.selectionRange;

  return {
    detail: typeHierarchyDetail(item, range),
    direction,
    id: `${direction}:${item.uri}:${item.name}:${range.start.line}:${range.start.character}:${index}`,
    item,
    kindLabel: symbolKindLabel(item.kind),
    label: item.name,
    range,
  };
}

function typeHierarchyDetail(
  item: LanguageServerTypeHierarchyItem,
  range: LanguageServerRange,
): string {
  const line = range.start.line + 1;

  if (item.detail) {
    return `${item.detail}:${line}`;
  }

  return `${item.uri}:${line}`;
}

function symbolKindLabel(kind: number): string {
  const labels: Record<number, string> = {
    5: "class",
    10: "enum",
    11: "interface",
    23: "struct",
    26: "type parameter",
  };

  return labels[kind] ?? "type";
}
