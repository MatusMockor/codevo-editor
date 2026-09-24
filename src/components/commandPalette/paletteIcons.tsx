import {
  Command as CommandIcon,
  Cpu,
  File,
  FileDiff,
  FileSearch,
  Folder,
  FolderPlus,
  GitBranch,
  Keyboard,
  Maximize2,
  MessageSquare,
  Monitor,
  Moon,
  Palette,
  PanelBottom,
  PanelRight,
  Play,
  Settings,
  SquarePen,
  Sun,
  type LucideIcon,
} from "lucide-react";
import type { PaletteGlyph, PaletteIcon } from "../../domain/commandPalette/paletteItem";

const GLYPHS: Readonly<Record<PaletteGlyph, LucideIcon>> = {
  newThread: SquarePen,
  folder: Folder,
  folderPlus: FolderPlus,
  fileSearch: FileSearch,
  file: File,
  play: Play,
  branch: GitBranch,
  diff: FileDiff,
  terminal: PanelBottom,
  panelRight: PanelRight,
  maximize: Maximize2,
  cpu: Cpu,
  palette: Palette,
  monitor: Monitor,
  sun: Sun,
  moon: Moon,
  keyboard: Keyboard,
  gear: Settings,
  message: MessageSquare,
  command: CommandIcon,
};

export function PaletteIconView({ icon }: { readonly icon: PaletteIcon }) {
  switch (icon.kind) {
    case "glyph": {
      const Glyph = GLYPHS[icon.glyph];
      return <Glyph size={16} />;
    }
    case "monogram":
      return <span className="cv-palette-monogram">{icon.letter}</span>;
    case "swatch":
      return <span className="cv-palette-swatch" style={{ background: icon.color }} />;
    default:
      return unreachableIcon(icon);
  }
}

function unreachableIcon(icon: never): never {
  return icon;
}
