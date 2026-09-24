import {
  Bot,
  FileText,
  Globe,
  Search,
  SquarePen,
  Terminal,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import {
  unsupportedToolRowKind,
  type AgentToolRowKind,
} from "../../domain/agentToolRowPresentation";

export function toolRowIcon(kind: AgentToolRowKind): LucideIcon {
  switch (kind) {
    case "command":
      return Terminal;
    case "read":
      return FileText;
    case "edit":
      return SquarePen;
    case "search":
      return Search;
    case "agent":
      return Bot;
    case "web":
      return Globe;
    case "other":
      return Wrench;
    default:
      return unsupportedToolRowKind(kind);
  }
}
