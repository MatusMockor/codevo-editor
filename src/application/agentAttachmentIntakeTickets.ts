export const MAX_PENDING_AGENT_ATTACHMENT_INTAKES = 16;
export const AGENT_ATTACHMENT_INTAKE_UNAVAILABLE_REFUSAL =
  "The attachment draft is unavailable. Select the project again.";
export const AGENT_ATTACHMENT_INTAKE_BUSY_REFUSAL =
  "Too many attachments are still being added. Wait for them to finish.";

export interface AgentAttachmentIntakeTicket {
  readonly kind: "agentAttachmentIntake";
}

const OPEN = new WeakSet<AgentAttachmentIntakeTicket>();

export function openAgentAttachmentIntakeTicket(): AgentAttachmentIntakeTicket {
  const ticket: AgentAttachmentIntakeTicket = Object.freeze({ kind: "agentAttachmentIntake" });
  OPEN.add(ticket);
  return ticket;
}

export function closeAgentAttachmentIntakeTicket(ticket: AgentAttachmentIntakeTicket): void {
  OPEN.delete(ticket);
}

export function agentAttachmentIntakeTicketIsOpen(ticket: AgentAttachmentIntakeTicket): boolean {
  return OPEN.has(ticket);
}
