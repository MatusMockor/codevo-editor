export const AGENT_INLINE_IMAGE_BUSY_MESSAGE = "Another image is being read. Try again shortly.";

export interface AgentInlineImageRequest {
  readonly workspaceId: string;
  readonly threadId: string;
  readonly path: string;
}

export interface AgentInlineImageGateway {
  readAgentInlineImage(request: AgentInlineImageRequest): Promise<ArrayBuffer>;
}

export function isAgentInlineImageBusyError(error: unknown): boolean {
  if (typeof error === "string") return error.trim() === AGENT_INLINE_IMAGE_BUSY_MESSAGE;
  if (error instanceof Error) return error.message.trim() === AGENT_INLINE_IMAGE_BUSY_MESSAGE;
  return false;
}
