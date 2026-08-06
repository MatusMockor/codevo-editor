import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { clearTimeout, setTimeout } from "node:timers";
import { assertBoundedCaptureJson } from "./perfCaptureContract.mjs";

const MAX_LAUNCHER_LINE_BYTES = 16 * 1024;
const MAX_LAUNCHER_ERROR_BYTES = 64 * 1024;
const LAUNCHER_STOP_TIMEOUT_MS = 30_000;
const LAUNCHER_STDIO_DRAIN_TIMEOUT_MS = 1_000;
const GRACEFUL_STOP_FRACTION = 0.1;
const TERM_STOP_FRACTION = 0.95;

export function spawnDirectApplicationSupervisor(plan, spawnProcess = spawn) {
  const child = spawnProcess(plan.command, plan.args, {
    cwd: plan.cwd,
    detached: true,
    env: plan.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let running = true;
  let processExited = false;
  let processExitStatus = null;
  let terminationRequested = false;
  let stopPromise = null;
  let forcedDrainTimer = null;
  let readyState = null;
  let terminalState = null;
  let protocolFailure = null;
  let stdoutBuffer = Buffer.alloc(0);
  let stdoutRejected = false;
  let stderr = "";
  let launchError = null;
  let settleReady;
  let rejectReady;
  let settleExited;
  let settleProcessExit;
  const ready = new Promise((resolve, reject) => {
    settleReady = resolve;
    rejectReady = reject;
  });
  const exited = new Promise((resolve) => {
    settleExited = resolve;
  });
  const processExit = new Promise((resolve) => {
    settleProcessExit = resolve;
  });

  const failReady = (message) => {
    protocolFailure ??= message;
    stdoutRejected = true;
    stdoutBuffer = Buffer.alloc(0);
    if (readyState !== null) return;
    readyState = false;
    rejectReady(new Error(message));
  };
  const finish = (status) => {
    if (!running) return;
    running = false;
    if (forcedDrainTimer !== null) {
      clearTimeout(forcedDrainTimer);
      forcedDrainTimer = null;
    }
    if (stdoutBuffer.length > 0) {
      processLauncherLine(stdoutBuffer.toString("utf8"));
      stdoutBuffer = Buffer.alloc(0);
    }
    if (readyState === null) {
      failReady(
        `Production application supervisor exited before publishing ownership (${describeStatus(status)}${stderrSuffix(stderr)}).`,
      );
    }
    const proofError = protocolFailure ?? validateTerminalProof(terminalState, readyState);
    settleExited({ ...status, error: status.error ?? proofError });
  };
  const markProcessExited = (status) => {
    if (processExited) return;
    processExited = true;
    processExitStatus = status;
    settleProcessExit(status);
    forcedDrainTimer = setTimeout(() => {
      forcedDrainTimer = null;
      child.stdout?.destroy?.();
      child.stderr?.destroy?.();
      finish(processExitStatus);
    }, LAUNCHER_STDIO_DRAIN_TIMEOUT_MS);
  };
  const processLauncherLine = (line) => {
    if (line.length === 0) return;
    let message;
    try {
      assertBoundedCaptureJson(line);
      message = JSON.parse(line);
    } catch {
      failReady("Production application supervisor published malformed ownership state.");
      return;
    }
    if (message?.state === "ready") {
      if (readyState !== null || !validReadyMessage(message, plan.expectedIdentity)) {
        failReady(
          "Production application supervisor published invalid or duplicate application ownership.",
        );
        return;
      }
      readyState = Object.freeze(message);
      settleReady(readyState);
      return;
    }
    if (message?.state === "terminated") {
      if (
        terminalState !== null ||
        !validTerminalMessage(message, plan.expectedIdentity, readyState)
      ) {
        failReady(
          "Production application supervisor published invalid or duplicate terminal ownership state.",
        );
        terminalState = false;
        return;
      }
      terminalState = Object.freeze(message);
      return;
    }
    failReady("Production application supervisor published an unknown ownership state.");
  };

  child.stdout?.on("data", (chunk) => {
    if (stdoutRejected) return;
    if (chunk.length > MAX_LAUNCHER_LINE_BYTES - stdoutBuffer.length) {
      stdoutRejected = true;
      stdoutBuffer = Buffer.alloc(0);
      failReady("Production application supervisor exceeded its bounded ownership output.");
      return;
    }
    stdoutBuffer = Buffer.concat([stdoutBuffer, chunk]);
    for (;;) {
      const newline = stdoutBuffer.indexOf(0x0a);
      if (newline < 0) break;
      const line = stdoutBuffer.subarray(0, newline).toString("utf8");
      stdoutBuffer = stdoutBuffer.subarray(newline + 1);
      processLauncherLine(line);
    }
  });
  child.stderr?.on("data", (chunk) => {
    if (Buffer.byteLength(stderr) >= MAX_LAUNCHER_ERROR_BYTES) return;
    stderr = Buffer.concat([Buffer.from(stderr), chunk])
      .subarray(0, MAX_LAUNCHER_ERROR_BYTES)
      .toString("utf8");
  });
  child.stdin?.on?.("error", (error) => {
    if (error?.code !== "EPIPE") {
      protocolFailure ??= `Production application supervisor input failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  });
  child.once("error", (error) => {
    launchError = error instanceof Error ? error.message : String(error);
    failReady(`Production application supervisor launch failed: ${launchError}`);
  });
  child.once("exit", (code, childSignal) => {
    markProcessExited({ code, signal: childSignal, error: launchError });
  });
  child.once("close", (code, childSignal) => {
    const status = processExitStatus ?? { code, signal: childSignal, error: launchError };
    markProcessExited(status);
    finish(status);
  });

  const requestGracefulStop = () => {
    if (!running || processExited || terminationRequested) return;
    terminationRequested = true;
    child.stdin?.end();
  };
  const signalExactChild = (signal) => {
    if (!running || processExited) return;
    try {
      child.kill(signal);
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  };
  const hasTerminalCleanupProof = () =>
    protocolFailure === null && validateTerminalProof(terminalState, readyState) === null;
  const stopExactChild = ({
    delay = defaultDelay,
    now = monotonicNow,
    timeoutMs = LAUNCHER_STOP_TIMEOUT_MS,
  } = {}) => {
    if (stopPromise !== null) return stopPromise;
    stopPromise = (async () => {
      requestGracefulStop();
      const startedAt = now();
      const gracefulDeadline = startedAt + timeoutMs * GRACEFUL_STOP_FRACTION;
      const termDeadline = startedAt + timeoutMs * TERM_STOP_FRACTION;
      const finalDeadline = startedAt + timeoutMs;

      if (!(await waitForExitUntil(processExit, { delay, now, deadline: gracefulDeadline }))) {
        signalExactChild("SIGTERM");
      }
      if (!(await waitForExitUntil(processExit, { delay, now, deadline: termDeadline }))) {
        if (!hasTerminalCleanupProof()) {
          throw new Error(
            "Production application supervisor did not publish terminal cleanup proof; refusing to SIGKILL its sole cleanup authority, and owned roots must be preserved.",
          );
        }
        signalExactChild("SIGKILL");
      }
      if (!(await waitForExitUntil(processExit, { delay, now, deadline: finalDeadline }))) {
        throw new Error(
          "Production application supervisor survived exact-child SIGKILL; cleanup remains unproven and owned roots must be preserved.",
        );
      }

      let outcome = await waitForExitUntil(exited, { delay, now, deadline: finalDeadline });
      if (outcome === null) {
        child.stdout?.destroy?.();
        child.stderr?.destroy?.();
        finish(processExitStatus);
        outcome = await exited;
      }
      if (outcome.error || outcome.code !== 0) {
        throw new Error(
          `Production application cleanup was not proven (${describeStatus(outcome)}${stderrSuffix(stderr)}).`,
        );
      }
    })();
    return stopPromise;
  };

  return {
    ready,
    exited,
    interrupt() {
      const stopping = stopExactChild();
      void stopping.catch(() => {});
      return stopping;
    },
    stop(options) {
      return stopExactChild(options);
    },
  };
}

function validReadyMessage(message, expected) {
  return (
    closedKeys(message, [
      "artifactSha256",
      "bundleManifestSha256",
      "bundleId",
      "bundlePath",
      "executablePath",
      "launchTimeMillis",
      "pgid",
      "pid",
      "runToken",
      "schemaVersion",
      "state",
    ]) &&
    message.schemaVersion === 1 &&
    message.state === "ready" &&
    message.runToken === expected.runToken &&
    message.artifactSha256 === expected.artifactSha256 &&
    message.bundleManifestSha256 === expected.bundleManifestSha256 &&
    message.bundlePath === expected.bundlePath &&
    message.executablePath === expected.executablePath &&
    message.bundleId === expected.bundleId &&
    Number.isSafeInteger(message.pid) &&
    message.pid > 0 &&
    message.pgid === message.pid &&
    Number.isSafeInteger(message.launchTimeMillis) &&
    message.launchTimeMillis > 0
  );
}

function validTerminalMessage(message, expected, ready) {
  return (
    closedKeys(message, [
      "bundleManifestSha256",
      "graceful",
      "pid",
      "runToken",
      "schemaVersion",
      "state",
    ]) &&
    message.schemaVersion === 1 &&
    message.state === "terminated" &&
    message.runToken === expected.runToken &&
    message.bundleManifestSha256 === expected.bundleManifestSha256 &&
    ready !== null &&
    ready !== false &&
    Number.isSafeInteger(message.pid) &&
    message.pid === ready.pid &&
    typeof message.graceful === "boolean"
  );
}

function validateTerminalProof(terminal, ready) {
  if (!ready || !terminal)
    return "Production application supervisor exited without terminal proof.";
  if (terminal.pid !== ready.pid)
    return "Production application terminal proof changed application identity.";
  if (!terminal.graceful) return "Production application required force termination.";
  return null;
}

function closedKeys(value, expected) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...expected].sort().join("\0")
  );
}

async function waitForExitUntil(exited, { delay, now, deadline }) {
  let completed = false;
  let status;
  exited.then((value) => {
    completed = true;
    status = value;
  });
  while (!completed) {
    const remaining = deadline - now();
    if (remaining <= 0) return null;
    await delay(Math.min(50, remaining));
  }
  return status;
}

function describeStatus(status) {
  return status.error
    ? `launch failed: ${status.error}`
    : `code ${status.code}, signal ${status.signal}`;
}

function stderrSuffix(stderr) {
  const normalized = stderr.trim().replaceAll(/\s+/g, " ");
  return normalized.length > 0 ? `: ${normalized}` : "";
}

function defaultDelay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function monotonicNow() {
  return performance.now();
}
