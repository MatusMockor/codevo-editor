import type {
  LanguageServerCallHierarchyItem,
  LanguageServerIncomingCall,
  LanguageServerOutgoingCall,
  LanguageServerRange,
} from "./languageServerFeatures";

export interface CallHierarchyView {
  incoming: LanguageServerIncomingCall[];
  item: LanguageServerCallHierarchyItem;
  outgoing: LanguageServerOutgoingCall[];
}

export interface CallHierarchyNavigationTarget {
  item: LanguageServerCallHierarchyItem;
  range: LanguageServerRange;
}

export type CallHierarchyDirection = "incoming" | "outgoing";

export interface CallHierarchyRow {
  detail: string;
  direction: CallHierarchyDirection;
  id: string;
  item: LanguageServerCallHierarchyItem;
  kindLabel: string;
  label: string;
  range: LanguageServerRange;
}

export function callHierarchyRows(view: CallHierarchyView): CallHierarchyRow[] {
  const incoming = view.incoming.map((call, index) => {
    const range = call.fromRanges[0] ?? call.from.selectionRange;

    return callHierarchyRow("incoming", call.from, range, index);
  });
  const outgoing = view.outgoing.map((call, index) =>
    callHierarchyRow("outgoing", call.to, call.to.selectionRange, index),
  );

  return [...incoming, ...outgoing];
}

export function callHierarchySectionTitle(
  direction: CallHierarchyDirection,
): string {
  return direction === "incoming" ? "Incoming calls" : "Outgoing calls";
}

function callHierarchyRow(
  direction: CallHierarchyDirection,
  item: LanguageServerCallHierarchyItem,
  range: LanguageServerRange,
  index: number,
): CallHierarchyRow {
  return {
    detail: callHierarchyDetail(item, range),
    direction,
    id: `${direction}:${item.uri}:${item.name}:${range.start.line}:${range.start.character}:${index}`,
    item,
    kindLabel: symbolKindLabel(item.kind),
    label: item.name,
    range,
  };
}

function callHierarchyDetail(
  item: LanguageServerCallHierarchyItem,
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
    6: "method",
    7: "property",
    8: "field",
    9: "constructor",
    10: "enum",
    11: "interface",
    12: "function",
    13: "variable",
    14: "constant",
    22: "enum member",
    23: "struct",
    24: "event",
    25: "operator",
    26: "type parameter",
  };

  return labels[kind] ?? "symbol";
}
