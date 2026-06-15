export function getTabId(path: string): string {
  return `tab-${toSafeElementId(path)}`;
}

export function getTabPanelId(path: string): string {
  return `tabpanel-${toSafeElementId(path)}`;
}

function toSafeElementId(value: string): string {
  return Array.from(value)
    .map((character) => {
      if (/^[a-zA-Z0-9_-]$/.test(character)) {
        return character;
      }

      return `_${character.charCodeAt(0).toString(16)}_`;
    })
    .join("");
}
