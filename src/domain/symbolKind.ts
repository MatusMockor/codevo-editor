const SYMBOL_ICON_LETTERS: Record<string, string> = {
  class: "C",
  constant: "c",
  enum: "E",
  function: "ƒ",
  interface: "I",
  method: "m",
  property: "p",
  trait: "T",
  variable: "v",
};

export function symbolKindLetter(kind: string): string {
  return SYMBOL_ICON_LETTERS[kind] ?? "·";
}
