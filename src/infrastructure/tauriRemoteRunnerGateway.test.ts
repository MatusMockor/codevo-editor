import { describe, expect, it, vi } from "vitest";
import { TauriRemoteRunnerGateway } from "./tauriRemoteRunnerGateway";
import { isRemoteRunnerRequestRejectedError } from "../domain/remoteRunnerErrors";
import { validateRemoteRunnerValue } from "../domain/remoteRunnerValidation";
const id = "12345678-1234-4234-8234-123456789abc";
const server = {
  id: "linux",
  name: "Linux server",
  host: "192.168.1.110",
  username: "codex",
  port: 22,
  connected: true,
};
const task = {
  id,
  sequence: 1,
  runnerId: "runner",
  provider: "codex",
  status: "draft",
  parts: [{ type: "text", text: "Fix the tests" }],
  createdAt: "2026-09-13T00:00:00.000Z",
};

describe("TauriRemoteRunnerGateway", () => {
  it.each(["in-place", "worktree"] as const)(
    "preserves task isolation %s across IPC",
    async (isolation) => {
      const returned = { ...task, isolation };
      const invoke = vi.fn().mockResolvedValue({ task: returned, created: true });
      const request = {
        serverId: "linux",
        idempotencyKey: id,
        provider: "codex" as const,
        isolation,
        parts: [{ type: "text" as const, text: "Fix" }],
      };
      expect((await new TauriRemoteRunnerGateway(invoke).createTask(request)).task.isolation).toBe(
        isolation,
      );
      expect(invoke).toHaveBeenCalledWith("remote_runner_create_task", { request });
    },
  );
  it.each([null, "local", "docker", true, {}])("rejects unsupported isolation %j", (isolation) => {
    expect(() =>
      validateRemoteRunnerValue("createTask", "request", {
        serverId: "linux",
        idempotencyKey: id,
        provider: "codex",
        isolation,
        parts: task.parts,
      }),
    ).toThrow();
    expect(() =>
      validateRemoteRunnerValue("getTask", "response", { ...task, isolation }),
    ).toThrow();
  });
  it("lists safe summaries and sends an exact typed SSH connection", async () => {
    const invoke = vi.fn().mockResolvedValueOnce([server]).mockResolvedValueOnce(server);
    const gateway = new TauriRemoteRunnerGateway(invoke);
    expect(await gateway.listServers()).toEqual([server]);
    const { connected: _connected, ...input } = server;
    expect(await gateway.connectServer(input)).toEqual(server);
    expect(invoke.mock.calls).toEqual([
      ["remote_runner_list_servers", undefined],
      ["remote_runner_connect_server", { request: input }],
    ]);
  });
  it("preserves the idempotency key and ordered attachment references", async () => {
    const invoke = vi.fn().mockResolvedValue({ task, created: true });
    const request = {
      serverId: "linux",
      idempotencyKey: id,
      provider: "codex" as const,
      parts: [
        { type: "text" as const, text: "Inspect" },
        { type: "attachment" as const, attachmentId: id },
      ],
    };
    expect(await new TauriRemoteRunnerGateway(invoke).createTask(request)).toEqual({
      task,
      created: true,
    });
    expect(invoke).toHaveBeenCalledWith("remote_runner_create_task", { request });
  });
  it.each(["-oProxyCommand=bad", "host;bad", "host\nother", "user@host"])(
    "rejects unsafe host %s before IPC",
    async (host) => {
      const invoke = vi.fn();
      const gateway = new TauriRemoteRunnerGateway(invoke);
      await expect(
        gateway.connectServer({ id: "linux", name: "Linux", host, username: "codex", port: 22 }),
      ).rejects.toThrow("request");
      expect(invoke).not.toHaveBeenCalled();
    },
  );
  it("rejects leaked credentials and unsupported capabilities in responses", async () => {
    const gateway = new TauriRemoteRunnerGateway(
      vi.fn().mockResolvedValue([{ ...server, token: "secret" }]),
    );
    await expect(gateway.listServers()).rejects.toThrow("response");
    const other = new TauriRemoteRunnerGateway(
      vi.fn().mockResolvedValue({
        protocolVersion: 2,
        runnerId: "runner",
        name: "Runner",
        capabilities: { taskExecution: true, eventReplay: true },
      }),
    );
    await expect(other.getRunner({ serverId: "linux" })).rejects.toThrow("response");
  });
  it("retains terminal cursor null and output channel", async () => {
    const page = {
      items: [
        {
          sequence: 3,
          taskId: id,
          type: "task.output",
          createdAt: task.createdAt,
          channel: "stdout",
          text: "working",
        },
      ],
      nextCursor: null,
    };
    const invoke = vi.fn().mockResolvedValue(page);
    expect(
      await new TauriRemoteRunnerGateway(invoke).listEvents({
        serverId: "linux",
        taskId: id,
        after: 2,
      }),
    ).toEqual(page);
  });
  it("rejects excessive pages and unknown status", () => {
    expect(() =>
      validateRemoteRunnerValue("listTasks", "response", {
        items: Array(51).fill(task),
        nextCursor: 51,
      }),
    ).toThrow();
    expect(() =>
      validateRemoteRunnerValue("getTask", "response", { ...task, status: "waiting" }),
    ).toThrow();
  });
  it("bounds UTF-8 prompt bytes and duplicate image references", () => {
    const request = {
      serverId: "linux",
      idempotencyKey: id,
      provider: "claude",
      parts: [{ type: "text", text: "🙂".repeat(12001) }],
    };
    expect(() => validateRemoteRunnerValue("createTask", "request", request)).toThrow();
    expect(() =>
      validateRemoteRunnerValue("createTask", "request", {
        ...request,
        parts: [
          { type: "attachment", attachmentId: id },
          { type: "attachment", attachmentId: id },
        ],
      }),
    ).toThrow();
  });
  it("rejects attachment paths and malformed base64", () => {
    const request = {
      serverId: "linux",
      attachmentId: id,
      name: "screen.png",
      mediaType: "image/png",
      base64: "aGVsbG8=",
    };
    expect(() => validateRemoteRunnerValue("uploadAttachment", "request", request)).not.toThrow();
    expect(() =>
      validateRemoteRunnerValue("uploadAttachment", "request", {
        ...request,
        name: "../screen.png",
      }),
    ).toThrow();
    expect(() =>
      validateRemoteRunnerValue("uploadAttachment", "request", { ...request, base64: "bad?!" }),
    ).toThrow();
  });
  it("matches native server name byte and control limits", () => {
    const { connected: _connected, ...input } = server;
    for (const name of ["a".repeat(81), "🙂".repeat(21), "Linux\nserver", "Linux\u0085server"]) {
      expect(() =>
        validateRemoteRunnerValue("connectServer", "request", { ...input, name }),
      ).toThrow();
    }
    expect(() =>
      validateRemoteRunnerValue("connectServer", "request", { ...input, name: "🙂".repeat(20) }),
    ).not.toThrow();
  });
  it("uses the same 64-character identifier alphabet as the runner", () => {
    for (const projectId of ["project.name", "p".repeat(65), "-project"]) {
      expect(() =>
        validateRemoteRunnerValue("startTask", "request", {
          serverId: "linux",
          taskId: id,
          projectId,
        }),
      ).toThrow();
    }
    expect(() =>
      validateRemoteRunnerValue("startTask", "request", {
        serverId: "linux",
        taskId: id,
        projectId: "p".repeat(64),
      }),
    ).not.toThrow();
    const { connected: _connected, ...input } = server;
    for (const serverId of ["server.name", "s".repeat(65)]) {
      expect(() =>
        validateRemoteRunnerValue("connectServer", "request", { ...input, id: serverId }),
      ).toThrow();
    }
  });
  it.each(["::1", "2001:db8::1", "[::1]"])(
    "consistently rejects unsupported IPv6 host %s",
    (host) => {
      const { connected: _connected, ...input } = server;
      expect(() =>
        validateRemoteRunnerValue("connectServer", "request", { ...input, host }),
      ).toThrow();
    },
  );
  it("preserves explicitly truncated diffs", async () => {
    const diff = { patch: "diff --git", truncated: true, untrackedFiles: ["new.ts"] };
    expect(
      await new TauriRemoteRunnerGateway(vi.fn().mockResolvedValue(diff)).getDiff({
        serverId: "linux",
        taskId: id,
      }),
    ).toEqual(diff);
  });
});

describe("remote project cloning boundary", () => {
  const request = {
    serverId: "linux",
    idempotencyKey: id,
    url: "git@github.com:owner/repo.git",
    name: "repo",
    branch: "feature/work",
  };
  const job = { id, status: "queued", project: null, error: null };
  it("sends typed clone, lookup and cancellation requests without changing their identity", async () => {
    const invoke = vi.fn().mockResolvedValue(job);
    const gateway = new TauriRemoteRunnerGateway(invoke);
    expect(await gateway.cloneProject(request)).toEqual(job);
    expect(await gateway.getProjectClone({ serverId: "linux", cloneId: id })).toEqual(job);
    expect(await gateway.cancelProjectClone({ serverId: "linux", cloneId: id })).toEqual(job);
    expect(invoke.mock.calls).toEqual([
      ["remote_runner_clone_project", { request }],
      ["remote_runner_get_project_clone", { request: { serverId: "linux", cloneId: id } }],
      ["remote_runner_cancel_project_clone", { request: { serverId: "linux", cloneId: id } }],
    ]);
  });
  it.each([
    "https://github.com/owner/repo.git",
    "ssh://git@host:2222/owner/repo.git",
    "git@192.168.1.110:owner/repo",
  ])("accepts supported remote %s", (url) => {
    expect(() =>
      validateRemoteRunnerValue("cloneProject", "request", { ...request, url }),
    ).not.toThrow();
  });
  it.each([
    "file:///tmp/repo",
    "/tmp/repo",
    "ext::command",
    "https://token@host/repo",
    "https://host:443/repo",
    "https://host/repo?token=x",
    "https://host/repo#ref",
    "https://host/%2e%2e/repo",
    "git@host:../repo",
    "git@host:/repo",
    "git@host:owner//repo",
    "ssh://git@host:0/repo",
    "ssh://git@host:65536/repo",
    "https://host/repo\n",
  ])("rejects unsafe or unsupported remote %s before IPC", async (url) => {
    const invoke = vi.fn();
    await expect(
      new TauriRemoteRunnerGateway(invoke).cloneProject({ ...request, url }),
    ).rejects.toThrow("request");
    expect(invoke).not.toHaveBeenCalled();
  });
  it.each([
    "",
    "-option",
    "main..other",
    "main@{1}",
    "a//b",
    "a.lock/b",
    ".hidden",
    "a/",
    "a.",
    "@",
    "branch name",
    "a".repeat(256),
  ])("rejects invalid branch %s", (branch) => {
    expect(() =>
      validateRemoteRunnerValue("cloneProject", "request", { ...request, branch }),
    ).toThrow();
  });
  it("accepts default and valid Unicode branches while bounding the folder and unknown fields", () => {
    const { branch: _branch, ...defaultBranch } = request;
    expect(() => validateRemoteRunnerValue("cloneProject", "request", defaultBranch)).not.toThrow();
    expect(() =>
      validateRemoteRunnerValue("cloneProject", "request", {
        ...request,
        branch: "feature/oprava-ž",
      }),
    ).not.toThrow();
    for (const name of ["../repo", ".agent", "repo.name", "repo\n", "a".repeat(65)]) {
      expect(() =>
        validateRemoteRunnerValue("cloneProject", "request", { ...request, name }),
      ).toThrow();
    }
    expect(() =>
      validateRemoteRunnerValue("cloneProject", "request", { ...request, command: "git clone" }),
    ).toThrow();
    expect(() =>
      validateRemoteRunnerValue("cloneProject", "request", {
        ...request,
        idempotencyKey: `${id}\n`,
      }),
    ).toThrow();
  });
  it("rejects malformed job state, oversized errors and private server paths", async () => {
    for (const response of [
      { ...job, status: "succeeded" },
      { ...job, status: "running", project: { id: "repo", name: "repo" } },
      { ...job, error: "a".repeat(257) },
      { ...job, path: "/home/user/Developer" },
      { ...job, status: "unknown" },
    ]) {
      await expect(
        new TauriRemoteRunnerGateway(vi.fn().mockResolvedValue(response)).getProjectClone({
          serverId: "linux",
          cloneId: id,
        }),
      ).rejects.toThrow("response");
    }
    const success = { ...job, status: "succeeded", project: { id: "repo", name: "repo" } };
    expect(
      await new TauriRemoteRunnerGateway(vi.fn().mockResolvedValue(success)).getProjectClone({
        serverId: "linux",
        cloneId: id,
      }),
    ).toEqual(success);
  });
  it("accepts optional cloning capability from new runners and its absence from older ones", () => {
    const descriptor = {
      protocolVersion: 1,
      runnerId: "runner",
      name: "Runner",
      capabilities: { taskExecution: true, eventReplay: true },
    };
    expect(() => validateRemoteRunnerValue("getRunner", "response", descriptor)).not.toThrow();
    expect(() =>
      validateRemoteRunnerValue("getRunner", "response", {
        ...descriptor,
        capabilities: { ...descriptor.capabilities, projectCloning: true },
      }),
    ).not.toThrow();
  });
});

describe("remote conversation continuation boundary", () => {
  it("preserves parent task, idempotency and ordered parts without allowing provider changes", async () => {
    const childId = "22345678-1234-4234-8234-123456789abc";
    const child = { ...task, id: childId, status: "queued", conversationId: id, parentTaskId: id };
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({ available: true, reason: null })
      .mockResolvedValueOnce({ task: child, created: false });
    const gateway = new TauriRemoteRunnerGateway(invoke);
    expect(await gateway.getTaskResume({ serverId: "linux", taskId: id })).toEqual({
      available: true,
      reason: null,
    });
    const request = {
      serverId: "linux",
      taskId: id,
      idempotencyKey: childId,
      parts: [{ type: "text" as const, text: "Continue with the existing changes" }],
    };
    expect(await gateway.continueTask(request)).toEqual({ task: child, created: false });
    expect(invoke.mock.calls).toEqual([
      ["remote_runner_get_task_resume", { request: { serverId: "linux", taskId: id } }],
      ["remote_runner_continue_task", { request }],
    ]);
    expect(() =>
      validateRemoteRunnerValue("continueTask", "request", { ...request, provider: "claude" }),
    ).toThrow();
  });
  it.each([
    { available: true, reason: "session_unavailable" },
    { available: false, reason: null },
    { available: false, reason: "unknown" },
    { available: true, reason: null, sessionId: "private" },
  ])("rejects contradictory or private resume metadata %j", (response) => {
    expect(() => validateRemoteRunnerValue("getTaskResume", "response", response)).toThrow();
  });
  it.each(["task_not_finished", "session_unavailable", "newer_turn_exists"])(
    "accepts closed unavailable reason %s",
    (reason) => {
      expect(() =>
        validateRemoteRunnerValue("getTaskResume", "response", { available: false, reason }),
      ).not.toThrow();
    },
  );
  it("bounds continuation prompts and validates conversation identifiers", () => {
    expect(() =>
      validateRemoteRunnerValue("continueTask", "request", {
        serverId: "linux",
        taskId: id,
        idempotencyKey: id,
        parts: [{ type: "text", text: "🙂".repeat(12001) }],
      }),
    ).toThrow();
    expect(() =>
      validateRemoteRunnerValue("getTask", "response", {
        ...task,
        conversationId: "private-session",
      }),
    ).toThrow();
    expect(() =>
      validateRemoteRunnerValue("getRunner", "response", {
        protocolVersion: 1,
        runnerId: "runner",
        name: "Runner",
        capabilities: { taskExecution: true, eventReplay: true, taskContinuation: true },
      }),
    ).not.toThrow();
  });
});

describe("continuation rejection certainty", () => {
  const request = {
    serverId: "linux",
    taskId: id,
    idempotencyKey: id,
    parts: [{ type: "text" as const, text: "Continue" }],
  };
  it.each([400, 404, 409, 413, 422])(
    "classifies authoritative HTTP %s rejection",
    async (status) => {
      const gateway = new TauriRemoteRunnerGateway(
        vi.fn().mockRejectedValue(`Runner request failed (HTTP ${status}).`),
      );
      const error = await gateway.continueTask(request).catch((error) => error);
      expect(isRemoteRunnerRequestRejectedError(error)).toBe(true);
    },
  );
  it.each([
    "Runner request failed (HTTP 500).",
    "Runner request failed (HTTP 408).",
    "Connection lost",
    "prefix Runner request failed (HTTP 409).",
  ])("retains uncertainty for %s", async (failure) => {
    const gateway = new TauriRemoteRunnerGateway(vi.fn().mockRejectedValue(failure));
    expect(await gateway.continueTask(request).catch((error) => error)).toBe(failure);
  });
  it("classifies local request validation before dispatch but not invalid server response", async () => {
    const invoke = vi.fn().mockResolvedValue({});
    const gateway = new TauriRemoteRunnerGateway(invoke);
    expect(
      isRemoteRunnerRequestRejectedError(
        await gateway.continueTask({ ...request, parts: [] }).catch((error) => error),
      ),
    ).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
    expect(
      isRemoteRunnerRequestRejectedError(
        await gateway.continueTask(request).catch((error) => error),
      ),
    ).toBe(false);
  });
});

describe("remote launch and historical image contracts", () => {
  it("passes exact launch options and rejects provider mismatches and unknown fields", async () => {
    const launch = {
      provider: "codex" as const,
      model: "gpt-6-astra" as const,
      mode: "workspaceWrite" as const,
    };
    const invoke = vi.fn().mockResolvedValue({ task: { ...task, launch }, created: true });
    const gateway = new TauriRemoteRunnerGateway(invoke);
    const request = {
      serverId: "linux",
      idempotencyKey: id,
      provider: "codex" as const,
      parts: [{ type: "text" as const, text: "hello" }],
      launch,
    };
    expect((await gateway.createTask(request)).task.launch).toEqual(launch);
    expect(invoke).toHaveBeenCalledWith("remote_runner_create_task", { request });
    expect(() =>
      validateRemoteRunnerValue("createTask", "request", { ...request, provider: "claude" }),
    ).toThrow();
    expect(() =>
      validateRemoteRunnerValue("continueTask", "request", {
        serverId: "linux",
        taskId: id,
        idempotencyKey: id,
        parts: request.parts,
        launch: { ...launch, args: ["--unsafe"] },
      }),
    ).toThrow();
  });
  it("reads bounded historical attachment metadata and image bytes", async () => {
    const attachment = {
      id,
      runnerId: "runner",
      name: "image.png",
      mediaType: "image/png",
      bytes: 3,
      sha256: "a".repeat(64),
      width: 1,
      height: 1,
      createdAt: task.createdAt,
    };
    const content = { mediaType: "image/png", base64: "YWJj" };
    const invoke = vi.fn().mockResolvedValueOnce(attachment).mockResolvedValueOnce(content);
    const gateway = new TauriRemoteRunnerGateway(invoke);
    const request = { serverId: "linux", attachmentId: id };
    expect(await gateway.getAttachment(request)).toEqual(attachment);
    expect(await gateway.readAttachment(request)).toEqual(content);
    expect(invoke.mock.calls).toEqual([
      ["remote_runner_get_attachment", { request }],
      ["remote_runner_read_attachment", { request }],
    ]);
    for (const invalid of [
      { ...content, mediaType: "image/svg+xml" },
      { ...content, base64: "!" },
      { ...content, base64: "A".repeat(11184816) },
      { ...content, base64: "A".repeat(11184812) },
      { ...content, path: "/etc/passwd" },
    ]) {
      expect(() => validateRemoteRunnerValue("readAttachment", "response", invalid)).toThrow();
    }
    expect(() =>
      validateRemoteRunnerValue("getAttachment", "request", {
        ...request,
        attachmentId: "../secret",
      }),
    ).toThrow();
  });
});

describe("remote per-file changes wire", () => {
  it("uses exact task-scoped file list and diff commands", async () => {
    const files = {
      files: [{ path: "src/new.ts", oldPath: "src/old.ts", status: "renamed" }],
      truncated: false,
    };
    const diff = {
      path: "src/new.ts",
      original: { text: "old", truncated: false },
      modified: { text: "new", truncated: false },
      unavailableReason: null,
    };
    const invoke = vi.fn().mockResolvedValueOnce(files).mockResolvedValueOnce(diff);
    const gateway = new TauriRemoteRunnerGateway(invoke);
    const request = { serverId: "linux", taskId: id };
    expect(await gateway.listTaskFiles(request)).toEqual(files);
    expect(await gateway.getTaskFileDiff({ ...request, path: diff.path })).toEqual(diff);
    expect(invoke.mock.calls).toEqual([
      ["remote_runner_list_task_files", { request }],
      ["remote_runner_get_task_file_diff", { request: { ...request, path: diff.path } }],
    ]);
  });
  it("rejects a valid diff for a different requested file", async () => {
    const gateway = new TauriRemoteRunnerGateway(
      vi.fn().mockResolvedValue({
        path: "other.ts",
        original: { text: "", truncated: false },
        modified: { text: "", truncated: false },
        unavailableReason: null,
      }),
    );
    await expect(
      gateway.getTaskFileDiff({ serverId: "linux", taskId: id, path: "expected.ts" }),
    ).rejects.toThrow("different file");
  });
  it("rejects traversal, unknown variants and oversized files", () => {
    for (const path of [
      "",
      "/etc/passwd",
      "../file",
      "src/../file",
      "./file",
      "src//file",
      "src/.GiT/config",
      "C:/file",
      "src\\file",
      "src\nfile",
      "src\0file",
      "é".repeat(2049),
    ]) {
      expect(() =>
        validateRemoteRunnerValue("getTaskFileDiff", "request", {
          serverId: "linux",
          taskId: id,
          path,
        }),
      ).toThrow();
    }
    expect(() =>
      validateRemoteRunnerValue("listTaskFiles", "response", {
        files: [{ path: "src/a", status: "copied" }],
        truncated: false,
      }),
    ).toThrow();
    expect(() =>
      validateRemoteRunnerValue("listTaskFiles", "response", {
        files: Array.from({ length: 1001 }, () => ({ path: "a", status: "modified" })),
        truncated: false,
      }),
    ).toThrow();
    expect(() =>
      validateRemoteRunnerValue("getTaskFileDiff", "response", {
        path: "a",
        original: { text: "é".repeat(32769), truncated: false },
        modified: { text: "", truncated: false },
        unavailableReason: null,
      }),
    ).toThrow();
    expect(() =>
      validateRemoteRunnerValue("getTaskFileDiff", "response", {
        path: "a",
        original: { text: "", truncated: true },
        modified: { text: "", truncated: true },
        unavailableReason: "large",
      }),
    ).not.toThrow();
  });
});
