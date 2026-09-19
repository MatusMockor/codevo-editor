import { describe, expect, it, vi } from "vitest";
import wire from "../../contracts/agent-turn-log-wire.json";
import {
  AgentTurnLogFailure,
  type AppendAgentTurnLogRequest,
  type DeleteAgentThreadLogRequest,
  type OpenAgentTurnLogRequest,
  type ReadAgentTurnLogPageRequest,
  type SummarizeAgentTurnLogsRequest,
} from "../domain/agentTurnLog";
import {
  AGENT_TURN_LOG_COMMANDS,
  TauriAgentTurnLogGateway,
  type InvokeAgentTurnLogCommand,
} from "./tauriAgentTurnLogGateway";

const openRequest = wire.requests.open[0] as unknown as OpenAgentTurnLogRequest;
const appendRequest = wire.requests.append[0] as unknown as AppendAgentTurnLogRequest;
const pageRequest = wire.requests.page[0] as unknown as ReadAgentTurnLogPageRequest;
const summarizeRequest = wire.requests.summarize[0] as unknown as SummarizeAgentTurnLogsRequest;
const deleteRequest = wire.requests.deleteThreadLog[0] as unknown as DeleteAgentThreadLogRequest;

describe("TauriAgentTurnLogGateway", () => {
  it("forwards validated requests and parses every response", async () => {
    const invokeCommand = vi.fn<InvokeAgentTurnLogCommand>();
    const gateway = new TauriAgentTurnLogGateway(invokeCommand);

    invokeCommand.mockResolvedValueOnce(wire.leases[0]);
    await expect(gateway.openTurnLog(openRequest)).resolves.toEqual(wire.leases[0]);

    invokeCommand.mockResolvedValueOnce(wire.receipts[1]);
    await expect(gateway.appendTurnLog(appendRequest)).resolves.toEqual(wire.receipts[1]);

    invokeCommand.mockResolvedValueOnce(wire.pages[0]);
    await expect(gateway.readTurnLogPage(pageRequest)).resolves.toEqual(wire.pages[0]);

    invokeCommand.mockResolvedValueOnce(wire.summaries[1]);
    await expect(gateway.summarizeTurnLogs(summarizeRequest)).resolves.toEqual(wire.summaries[1]);

    expect(invokeCommand.mock.calls.map(([command]) => command)).toEqual([
      AGENT_TURN_LOG_COMMANDS.open,
      AGENT_TURN_LOG_COMMANDS.append,
      AGENT_TURN_LOG_COMMANDS.readPage,
      AGENT_TURN_LOG_COMMANDS.summarize,
    ]);
    expect(invokeCommand.mock.calls[0]?.[1]).toEqual({ request: openRequest });
    expect(invokeCommand.mock.calls[1]?.[1]).toEqual({ request: appendRequest });
  });

  it("refuses an outbound request the backend would reject", async () => {
    const invokeCommand = vi.fn<InvokeAgentTurnLogCommand>();
    const gateway = new TauriAgentTurnLogGateway(invokeCommand);

    await expect(
      gateway.appendTurnLog({
        ...appendRequest,
        ops: [
          ...appendRequest.ops,
          { seq: 9, event: { kind: "assistantText", text: "out of order" } },
        ],
      }),
    ).rejects.toThrow(/contiguous sequence/u);
    await expect(gateway.readTurnLogPage({ ...pageRequest, maxEvents: 5_000 })).rejects.toThrow(
      /1 to 200/u,
    );
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("fails closed on an inbound response it cannot parse", async () => {
    const invokeCommand = vi.fn<InvokeAgentTurnLogCommand>();
    const gateway = new TauriAgentTurnLogGateway(invokeCommand);

    invokeCommand.mockResolvedValueOnce({ ...wire.leases[0], sealed: false });
    await expect(gateway.openTurnLog(openRequest)).rejects.toThrow(/not present/u);

    invokeCommand.mockResolvedValueOnce(wire.rejectedReceipts[0]?.value);
    await expect(gateway.appendTurnLog(appendRequest)).rejects.toThrow(
      /sequence before the next sequence/u,
    );

    invokeCommand.mockResolvedValueOnce(wire.rejectedPages[1]?.value);
    await expect(gateway.readTurnLogPage(pageRequest)).rejects.toThrow(/above the previous entry/u);
  });

  it("maps a closed backend code to a typed failure", async () => {
    const invokeCommand = vi.fn<InvokeAgentTurnLogCommand>();
    const gateway = new TauriAgentTurnLogGateway(invokeCommand);

    for (const code of wire.errors) {
      invokeCommand.mockRejectedValueOnce(code);
      const failure = await gateway.openTurnLog(openRequest).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(AgentTurnLogFailure);
      expect((failure as AgentTurnLogFailure).code).toBe(code);
    }
  });

  it("registers exactly the commands the shared contract names", () => {
    expect(AGENT_TURN_LOG_COMMANDS).toEqual(wire.commands);
  });

  it("deletes a thread log through the validated command", async () => {
    const invokeCommand = vi.fn<InvokeAgentTurnLogCommand>();
    const gateway = new TauriAgentTurnLogGateway(invokeCommand);

    for (const result of wire.deleteThreadLogResults) {
      invokeCommand.mockResolvedValueOnce(result);
      await expect(gateway.deleteThreadLog(deleteRequest)).resolves.toEqual(result);
    }
    expect(invokeCommand.mock.calls.map(([command]) => command)).toEqual(
      wire.deleteThreadLogResults.map(() => AGENT_TURN_LOG_COMMANDS.deleteThreadLog),
    );
    expect(invokeCommand.mock.calls[0]?.[1]).toEqual({ request: deleteRequest });
  });

  it("refuses a deletion the backend would reject and a result it cannot parse", async () => {
    const invokeCommand = vi.fn<InvokeAgentTurnLogCommand>();
    const gateway = new TauriAgentTurnLogGateway(invokeCommand);

    for (const rejected of wire.rejectedRequests.deleteThreadLog) {
      await expect(
        gateway.deleteThreadLog(rejected.value as unknown as DeleteAgentThreadLogRequest),
      ).rejects.toThrow(TypeError);
    }
    expect(invokeCommand).not.toHaveBeenCalled();

    for (const rejected of wire.rejectedDeleteThreadLogResults) {
      invokeCommand.mockResolvedValueOnce(rejected.value);
      await expect(gateway.deleteThreadLog(deleteRequest)).rejects.toThrow(TypeError);
    }
  });

  it("maps a deletion failure to the same closed codes", async () => {
    const invokeCommand = vi.fn<InvokeAgentTurnLogCommand>();
    const gateway = new TauriAgentTurnLogGateway(invokeCommand);

    invokeCommand.mockRejectedValueOnce("busy");
    const busy = await gateway.deleteThreadLog(deleteRequest).catch((error: unknown) => error);
    expect(busy).toBeInstanceOf(AgentTurnLogFailure);
    expect((busy as AgentTurnLogFailure).code).toBe("busy");

    for (const entry of wire.sequenceGapErrors) {
      invokeCommand.mockRejectedValueOnce(entry.value);
      const failure = await gateway.appendTurnLog(appendRequest).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(AgentTurnLogFailure);
      expect((failure as AgentTurnLogFailure).code).toBe("sequenceGap");
      expect((failure as AgentTurnLogFailure).nextSeq).toBe(entry.nextSeq);
    }
  });

  it("propagates an unknown transport failure untouched", async () => {
    const transport = new Error("ipc closed");
    const invokeCommand = vi.fn<InvokeAgentTurnLogCommand>().mockRejectedValue(transport);
    const gateway = new TauriAgentTurnLogGateway(invokeCommand);

    await expect(gateway.openTurnLog(openRequest)).rejects.toBe(transport);
    await expect(gateway.summarizeTurnLogs(summarizeRequest)).rejects.toBe(transport);
  });
});
