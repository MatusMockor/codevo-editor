import "./controls.css";

export interface KbdProps {
  readonly children: string;
}

export function Kbd({ children }: KbdProps) {
  return <kbd className="cv-kbd">{children}</kbd>;
}

export interface ShortcutKeysProps {
  readonly keys: readonly string[];
  readonly label: string;
}

export function ShortcutKeys({ keys, label }: ShortcutKeysProps) {
  return (
    <span aria-label={label} className="cv-kbd-group" role="img">
      {keys.map((key, index) => (
        <Kbd key={`${index}-${key}`}>{key}</Kbd>
      ))}
    </span>
  );
}
