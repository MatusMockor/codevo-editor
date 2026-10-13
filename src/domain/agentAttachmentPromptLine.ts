import type { AgentAttachment } from "./agentAttachment";
import { agentAttachmentPromptLine } from "./agentAttachmentIntake";
import type { AgentReferenceEntry } from "./agentReferenceEntry";

export const AGENT_ATTACHMENT_PROMPT_LINE_KINDS = ["image", "file", "reference", "folder"] as const;
export type AgentAttachmentPromptLineKind = (typeof AGENT_ATTACHMENT_PROMPT_LINE_KINDS)[number];

export interface AgentAttachmentPromptLine {
  readonly kind: AgentAttachmentPromptLineKind;
  readonly name: string;
  readonly path: string;
}

interface LineForm {
  readonly kind: AgentAttachmentPromptLineKind;
  readonly prefix: string;
  readonly separator: string;
  readonly suffix: string;
}

interface LineMatch {
  readonly form: LineForm;
  readonly nameEnd: number;
}

const NAME_PROBE = "<attachment-name>";
const PATH_PROBE = "<attachment-path>";
const PROBE_ID = "0".repeat(32);
const FORMS: readonly LineForm[] = AGENT_ATTACHMENT_PROMPT_LINE_KINDS.map(lineForm);

export function parseAgentAttachmentPromptLine(line: string): AgentAttachmentPromptLine | null {
  const match = FORMS.reduce<LineMatch | null>(
    (best, form) => earlierMatch(best, lineMatch(form, line)),
    null,
  );
  if (match === null) return null;
  const { form, nameEnd } = match;
  return {
    kind: form.kind,
    name: line.slice(form.prefix.length, nameEnd),
    path: line.slice(nameEnd + form.separator.length, line.length - form.suffix.length),
  };
}

function lineMatch(form: LineForm, line: string): LineMatch | null {
  if (form.separator === "" || !line.startsWith(form.prefix) || !line.endsWith(form.suffix))
    return null;
  const nameEnd = line.indexOf(form.separator, form.prefix.length);
  if (nameEnd <= form.prefix.length) return null;
  if (nameEnd + form.separator.length > line.length - form.suffix.length) return null;
  return { form, nameEnd };
}

function earlierMatch(best: LineMatch | null, candidate: LineMatch | null): LineMatch | null {
  if (candidate === null) return best;
  if (best === null || candidate.nameEnd < best.nameEnd) return candidate;
  return best;
}

function lineForm(kind: AgentAttachmentPromptLineKind): LineForm {
  const line = agentAttachmentPromptLine(probe(kind), () => probeEntry(kind));
  const nameAt = line.indexOf(NAME_PROBE);
  const pathAt = line.indexOf(PATH_PROBE);
  if (nameAt < 0 || pathAt < nameAt) return { kind, prefix: "", separator: "", suffix: "" };
  return {
    kind,
    prefix: line.slice(0, nameAt),
    separator: line.slice(nameAt + NAME_PROBE.length, pathAt),
    suffix: line.slice(pathAt + PATH_PROBE.length),
  };
}

function probe(kind: AgentAttachmentPromptLineKind): AgentAttachment {
  switch (kind) {
    case "image":
      return {
        kind: "image",
        attachmentId: PROBE_ID,
        name: NAME_PROBE,
        mime: "image/png",
        bytes: 0,
        width: 1,
        height: 1,
        storedPath: PATH_PROBE,
      };
    case "file":
      return {
        kind: "file",
        attachmentId: PROBE_ID,
        name: NAME_PROBE,
        bytes: 0,
        storedPath: PATH_PROBE,
      };
    case "reference":
    case "folder":
      return { kind: "reference", name: NAME_PROBE, path: PATH_PROBE, bytes: 0 };
    default:
      return unsupportedKind(kind);
  }
}

function probeEntry(kind: AgentAttachmentPromptLineKind): AgentReferenceEntry {
  return kind === "folder" ? "directory" : "file";
}

function unsupportedKind(kind: never): never {
  throw new TypeError(`Unsupported agent attachment prompt line kind: ${String(kind)}.`);
}
