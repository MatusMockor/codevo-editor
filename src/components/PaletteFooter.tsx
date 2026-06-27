// Shared JetBrains-classic footer hint shown at the bottom of the command
// palettes (Command palette, Quick Open, Class Open, Search Everywhere, File
// Structure). Presentation only and theme-aware via the --color-* tokens.
export function PaletteFooter() {
  return (
    <div aria-hidden="true" className="palette-footer">
      <span>
        <kbd>↑</kbd>
        <kbd>↓</kbd>
        navigate
      </span>
      <span>
        <kbd>↵</kbd>
        open
      </span>
      <span>
        <kbd>esc</kbd>
        close
      </span>
    </div>
  );
}
