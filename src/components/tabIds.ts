export function getTabId(path: string, groupId?: string): string {
  return `tab-${groupPrefix(groupId)}${toSafeElementId(path)}`;
}

export function getTabPanelId(path: string, groupId?: string): string {
  return `tabpanel-${groupPrefix(groupId)}${toSafeElementId(path)}`;
}

function groupPrefix(groupId: string | undefined): string {
  return groupId ? `${toSafeElementId(groupId)}-` : "";
}

function toSafeElementId(value: string): string {
  return Array.from({ length: value.length }, (_, index) =>
    value.charCodeAt(index).toString(16).padStart(4, "0")
  ).join("");
}
