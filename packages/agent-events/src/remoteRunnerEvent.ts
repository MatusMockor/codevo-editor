export type RemoteRunnerProvider = "claude" | "codex";

export type RemoteRunnerPart =
  Readonly<{ type: "text"; text: string }> | Readonly<{ type: "attachment"; attachmentId: string }>;

export type RemoteRunnerEvent = Readonly<{
  sequence: number;
  taskId: string;
  type:
    | "task.created"
    | "task.queued"
    | "task.running"
    | "task.succeeded"
    | "task.failed"
    | "task.interrupted"
    | "task.cancelled"
    | "task.output"
    | "task.input";
  createdAt: string;
  channel?: "stdout" | "stderr";
  text?: string;
  messageId?: string;
  parts?: readonly RemoteRunnerPart[];
  exitCode?: number | null;
  error?: string;
}>;
