export const AGENT_IMAGE_MIMES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;

export type AgentImageMime = (typeof AGENT_IMAGE_MIMES)[number];

export type AgentAttachment =
  | ({
      readonly kind: "image";
      readonly attachmentId: string;
      readonly name: string;
      readonly mime: AgentImageMime;
      readonly bytes: number;
      readonly width: number;
      readonly height: number;
    } & (
      | { readonly storedPath: string; readonly remote?: never }
      | {
          readonly storedPath?: never;
          readonly remote: { readonly serverId: string; readonly attachmentId: string };
        }
    ))
  | ({
      readonly kind: "file";
      readonly attachmentId: string;
      readonly name: string;
      readonly bytes: number;
    } & (
      | { readonly storedPath: string; readonly remote?: never }
      | {
          readonly storedPath?: never;
          readonly remote: { readonly serverId: string; readonly attachmentId: string };
        }
    ))
  | {
      readonly kind: "reference";
      readonly name: string;
      readonly path: string;
      readonly bytes: number;
    };

export type AgentAttachmentKind = AgentAttachment["kind"];
