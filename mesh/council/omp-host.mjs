import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import {
  COUNCIL_LIMITS,
  COUNCIL_POLICY_VERSION,
  validatePreflight,
} from "./host.mjs";

const WORKER_ENTRY = fileURLToPath(new URL("./runtime/worker.ts", import.meta.url));
const WORKER_CWD = dirname(WORKER_ENTRY);
const SAFE_CODES = new Set([
  "INVALID_REQUEST", "UNAVAILABLE", "POLICY_DENIED", "TIMED_OUT", "ABORTED", "TOO_LARGE", "INVALID_RESPONSE",
]);
const SAFE_MESSAGES = Object.freeze({
  INVALID_REQUEST: "Council worker request is invalid.",
  UNAVAILABLE: "Pinned Council worker is unavailable.",
  POLICY_DENIED: "Council worker policy rejected the operation.",
  TIMED_OUT: "Council worker operation timed out.",
  ABORTED: "Council worker operation was aborted.",
  TOO_LARGE: "Council worker input or output exceeded its bound.",
  INVALID_RESPONSE: "Council worker response was invalid.",
});
const BROKER_ENV_KEYS = [
  "OMP_AUTH_BROKER_URL",
  "OMP_AUTH_BROKER_TOKEN",
  "OMP_AUTH_BROKER_SNAPSHOT_TTL_MS",
  "OMP_AUTH_BROKER_SNAPSHOT_CACHE",
  "OMP_AUTH_BROKER_ACCOUNT_POOL_FILE",
];
const CONFIG_ENV_KEYS = [
  "HOME",
  "PI_CONFIG_DIR",
  "PI_CODING_AGENT_DIR",
  "OMP_PROFILE",
  "PI_PROFILE",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME",
  "XDG_CACHE_HOME",
];
function safePath() {
  return [dirname(process.execPath), "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"]
    .filter((value, index, values) => values.indexOf(value) === index)
    .join(delimiter);
}

class OmpHostError extends Error {
  constructor(code) {
    super(SAFE_MESSAGES[code] ?? SAFE_MESSAGES.INVALID_RESPONSE);
    this.name = "OmpHostError";
    this.code = SAFE_CODES.has(code) ? code : "INVALID_RESPONSE";
  }
}

function isRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validUnicode(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0) return false;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function validOptions(value, allowedKeys) {
  try {
    if (!isRecord(value)) return false;
    const keys = Reflect.ownKeys(value);
    if (keys.some(key => typeof key !== "string" || !allowedKeys.includes(key))) return false;
    return keys.every(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor?.enumerable && Object.hasOwn(descriptor, "value");
    });
  } catch {
    return false;
  }
}

function validRequest(operation, request) {
  try {
    if (!isRecord(request)) return false;
    const role = Object.getOwnPropertyDescriptor(request, "role");
    if (!role?.enumerable || !Object.hasOwn(role, "value")) return false;
    return (operation !== "preflight" || role.value === "lead")
      && (operation !== "call" || ["lead", "risk"].includes(role.value));
  } catch {
    return false;
  }
}

function encodeBoundedJson(value, maxBytes, invalidCode) {
  let bytes = 0;
  let nodes = 0;
  const ancestors = new WeakSet();
  const chunks = [];
  const append = text => {
    bytes += Buffer.byteLength(text, "utf8");
    if (bytes > maxBytes) throw new OmpHostError("TOO_LARGE");
    chunks.push(text);
  };
  const visit = (item, depth) => {
    nodes += 1;
    if (nodes > 12000 || depth > 32) throw new OmpHostError(invalidCode);
    if (item === null) {
      append("null");
      return;
    }
    if (typeof item === "string") {
      if (!validUnicode(item)) throw new OmpHostError(invalidCode);
      if (Buffer.byteLength(item, "utf8") > maxBytes) throw new OmpHostError("TOO_LARGE");
      append(JSON.stringify(item));
      return;
    }
    if (typeof item === "boolean") {
      append(item ? "true" : "false");
      return;
    }
    if (typeof item === "number") {
      if (!Number.isFinite(item)) throw new OmpHostError(invalidCode);
      append(JSON.stringify(item));
      return;
    }
    if (typeof item !== "object" || ancestors.has(item)) throw new OmpHostError(invalidCode);
    ancestors.add(item);
    if (Array.isArray(item)) {
      if (Object.getPrototypeOf(item) !== Array.prototype || item.length > 12000) throw new OmpHostError(invalidCode);
      const keys = Reflect.ownKeys(item);
      const lengthDescriptor = Object.getOwnPropertyDescriptor(item, "length");
      if (keys.length !== item.length + 1 || keys.some(key => typeof key !== "string")
          || !lengthDescriptor || lengthDescriptor.enumerable || !Object.hasOwn(lengthDescriptor, "value")) {
        throw new OmpHostError(invalidCode);
      }
      append("[");
      for (let index = 0; index < item.length; index += 1) {
        if (index) append(",");
        const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
        if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
          throw new OmpHostError(invalidCode);
        }
        visit(descriptor.value, depth + 1);
      }
      append("]");
    } else {
      if (!isRecord(item)) throw new OmpHostError(invalidCode);
      const keys = Reflect.ownKeys(item);
      if (keys.some(key => typeof key !== "string")) throw new OmpHostError(invalidCode);
      append("{");
      for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index];
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!validUnicode(key) || !descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
          throw new OmpHostError(invalidCode);
        }
        if (index) append(",");
        append(JSON.stringify(key));
        append(":");
        visit(descriptor.value, depth + 1);
      }
      append("}");
    }
    ancestors.delete(item);
  };
  visit(value, 0);
  return chunks.join("");
}

function workerEnvironment(nativeDir) {
  const temp = dirname(nativeDir);
  const env = {
    PATH: safePath(),
    HOME: process.env.HOME || homedir(),
    TMPDIR: temp,
    TMP: temp,
    TEMP: temp,
    LANG: "C.UTF-8",
    NO_COLOR: "1",
    PI_NATIVES_DIR: nativeDir,
  };
  for (const key of [...CONFIG_ENV_KEYS, ...BROKER_ENV_KEYS]) {
    const value = process.env[key];
    if (typeof value === "string") env[key] = value;
  }
  return env;
}

function configuredBun() {
  const executable = process.env.FALCON_MESH_COUNCIL_BUN;
  if (typeof executable !== "string" || executable.length === 0 || executable.length > 4096
      || executable.includes("\0") || !isAbsolute(executable)) {
    throw new OmpHostError("UNAVAILABLE");
  }
  return executable;
}

function safePreflight(reason) {
  return {
    schemaVersion: 2,
    policyVersion: COUNCIL_POLICY_VERSION,
    status: "NO_DATA",
    checkedAt: new Date().toISOString(),
    sdkVersion: null,
    provider: null,
    modelId: null,
    api: null,
    effort: null,
    endpoint: null,
    transportMode: null,
    bodyAudit: "NOT_RUN",
    payloadObservationCount: 0,
    fetchFenceCallCount: 0,
    providerDispatchCount: 0,
    reasons: [reason],
  };
}

function parseWorkerOutput(bytes, operation) {
  if (bytes.length < 2 || bytes[bytes.length - 1] !== 0x0a) throw new OmpHostError("INVALID_RESPONSE");
  const lineBytes = bytes.subarray(0, bytes.length - 1);
  if (lineBytes.includes(0x0a) || lineBytes.includes(0x0d)) throw new OmpHostError("INVALID_RESPONSE");
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(lineBytes);
  } catch {
    throw new OmpHostError("INVALID_RESPONSE");
  }
  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch {
    throw new OmpHostError("INVALID_RESPONSE");
  }
  if (!isRecord(envelope) || envelope.schemaVersion !== 1 || envelope.operation !== operation
      || typeof envelope.ok !== "boolean") throw new OmpHostError("INVALID_RESPONSE");
  const keys = Reflect.ownKeys(envelope);
  if (keys.some(key => typeof key !== "string")) throw new OmpHostError("INVALID_RESPONSE");
  if (envelope.ok) {
    if (keys.length !== 4 || !["schemaVersion", "operation", "ok", "result"].every(key => Object.hasOwn(envelope, key))
        || !isRecord(envelope.result)) throw new OmpHostError("INVALID_RESPONSE");
    encodeBoundedJson(envelope.result, COUNCIL_LIMITS.modelJsonBytes, "INVALID_RESPONSE");
    return envelope.result;
  }
  if (keys.length !== 4 || !["schemaVersion", "operation", "ok", "error"].every(key => Object.hasOwn(envelope, key))
      || typeof envelope.error !== "string" || !SAFE_CODES.has(envelope.error)) {
    throw new OmpHostError("INVALID_RESPONSE");
  }
  throw new OmpHostError(envelope.error);
}

function signalOwnedGroup(child, signal) {
  if (!child || !Number.isInteger(child.pid)) return;
  try {
    process.kill(-child.pid, signal);
    return;
  } catch {}
  try {
    child.kill(signal);
  } catch {}
}

export function createOmpTransport() {
  const active = new Set();
  let closed = false;
  let closePromise = null;

  function run(operation, request, options = {}) {
    const opLimit = operation === "preflight" ? COUNCIL_LIMITS.preflightMs : COUNCIL_LIMITS.callMs;
    if (!validOptions(options, ["signal", "budgetMs"])) return Promise.reject(new OmpHostError("INVALID_REQUEST"));
    const { signal, budgetMs } = options;
    if (closed) return Promise.reject(new OmpHostError("UNAVAILABLE"));
    // Windows lacks the process-group termination this adapter requires.
    if (process.platform === "win32") return Promise.reject(new OmpHostError("UNAVAILABLE"));
    if (signal !== undefined && (!signal || typeof signal.aborted !== "boolean"
        || typeof signal.addEventListener !== "function" || typeof signal.removeEventListener !== "function")) {
      return Promise.reject(new OmpHostError("INVALID_REQUEST"));
    }
    if (signal?.aborted) return Promise.reject(new OmpHostError("ABORTED"));
    if (budgetMs !== undefined && (!Number.isInteger(budgetMs) || budgetMs <= 0 || budgetMs > COUNCIL_LIMITS.runMs)) {
      return Promise.reject(new OmpHostError("INVALID_REQUEST"));
    }
    if (!validRequest(operation, request)) return Promise.reject(new OmpHostError("INVALID_REQUEST"));

    const effectiveBudgetMs = Math.min(budgetMs ?? opLimit, opLimit);
    let input;
    try {
      const requestJson = encodeBoundedJson(request, COUNCIL_LIMITS.requestBytes, "INVALID_REQUEST");
      const message = `{"schemaVersion":1,"operation":${JSON.stringify(operation)},"request":${requestJson},"budgetMs":${effectiveBudgetMs}}`;
      if (Buffer.byteLength(message, "utf8") + 1 > COUNCIL_LIMITS.ipcInputBytes) throw new OmpHostError("TOO_LARGE");
      input = Buffer.from(message + "\n", "utf8");
    } catch (error) {
      return Promise.reject(error instanceof OmpHostError ? error : new OmpHostError("INVALID_REQUEST"));
    }

    let executable;
    try {
      executable = configuredBun();
    } catch (error) {
      return Promise.reject(error);
    }

    const entry = { promise: null, stop: null };
    const task = new Promise((resolve, reject) => {
      const startedAt = performance.now();
      let child;
      let tempRoot;
      let stdoutBytes = 0;
      let stderrBytes = 0;
      const stdoutChunks = [];
      let setupComplete = false;
      let closeSeen = false;
      let exitCode = null;
      let forcedCode = null;
      let killComplete = false;
      let settled = false;
      let deadlineTimer = null;
      let killTimer = null;
      let removeAbortListener = () => {};

      const finish = (code, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadlineTimer);
        clearTimeout(killTimer);
        removeAbortListener();
        void (async () => {
          try {
            if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
          } catch {
            reject(new OmpHostError("UNAVAILABLE"));
            return;
          }
          if (code) reject(new OmpHostError(code));
          else resolve(value);
        })();
      };
      const maybeFinish = () => {
        if (!setupComplete || !closeSeen || settled || (forcedCode && !killComplete)) return;
        if (!forcedCode && performance.now() - startedAt >= effectiveBudgetMs) {
          stop("TIMED_OUT");
          return;
        }
        if (forcedCode) {
          finish(forcedCode);
          return;
        }
        if (exitCode !== 0) {
          stop("INVALID_RESPONSE");
          return;
        }
        try {
          finish(null, parseWorkerOutput(Buffer.concat(stdoutChunks, stdoutBytes), operation));
        } catch (error) {
          stop(error instanceof OmpHostError ? error.code : "INVALID_RESPONSE");
        }
      };
      const stop = code => {
        if (settled || forcedCode) return;
        forcedCode = code;
        if (!child || !Number.isInteger(child.pid)) {
          killComplete = true;
          if (setupComplete) closeSeen = true;
          maybeFinish();
          return;
        }
        signalOwnedGroup(child, "SIGTERM");
        killTimer = setTimeout(() => {
          signalOwnedGroup(child, "SIGKILL");
          killComplete = true;
          maybeFinish();
        }, COUNCIL_LIMITS.killGraceMs);
      };
      entry.stop = stop;
      active.add(entry);

      const onAbort = () => stop("ABORTED");
      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
        removeAbortListener = () => signal.removeEventListener("abort", onAbort);
      }
      deadlineTimer = setTimeout(() => stop("TIMED_OUT"), effectiveBudgetMs);

      const startWorker = async () => {
        try {
          const tempBase = tmpdir();
          if (!isAbsolute(tempBase)) throw new OmpHostError("UNAVAILABLE");
          tempRoot = await mkdtemp(join(tempBase, "falcon-council-worker-"));
          if (!isAbsolute(tempRoot)) throw new OmpHostError("UNAVAILABLE");
          if (forcedCode) {
            setupComplete = true;
            closeSeen = true;
            maybeFinish();
            return;
          }
          const nativeDir = join(tempRoot, "natives");
          await mkdir(nativeDir, { mode: 0o700 });
          if (forcedCode) {
            setupComplete = true;
            closeSeen = true;
            maybeFinish();
            return;
          }

          child = spawn(executable, ["run", WORKER_ENTRY], {
            cwd: WORKER_CWD,
            env: workerEnvironment(nativeDir),
            shell: false,
            detached: true,
            windowsHide: true,
            stdio: ["pipe", "pipe", "pipe"],
          });
          child.once("error", () => {
            if (!Number.isInteger(child.pid)) {
              forcedCode ||= "UNAVAILABLE";
              killComplete = true;
              setupComplete = true;
              closeSeen = true;
              maybeFinish();
            } else {
              stop("UNAVAILABLE");
            }
          });
          child.stdout.on("data", chunk => {
            if (forcedCode) return;
            stdoutBytes += chunk.length;
            if (stdoutBytes > COUNCIL_LIMITS.ipcOutputBytes) {
              stop("TOO_LARGE");
              return;
            }
            stdoutChunks.push(chunk);
          });
          child.stdout.on("error", () => stop("INVALID_RESPONSE"));
          child.stderr.on("data", chunk => {
            if (forcedCode) return;
            stderrBytes += chunk.length;
            if (stderrBytes > COUNCIL_LIMITS.ipcErrorBytes) stop("TOO_LARGE");
          });
          child.stderr.on("error", () => stop("INVALID_RESPONSE"));
          child.stdin.on("error", () => stop("INVALID_RESPONSE"));
          child.once("close", code => {
            closeSeen = true;
            exitCode = code;
            maybeFinish();
          });
          setupComplete = true;
          child.stdin.end(input);
        } catch {
          setupComplete = true;
          if (child && Number.isInteger(child.pid)) {
            if (!forcedCode) stop("UNAVAILABLE");
          } else {
            closeSeen = true;
            forcedCode ||= "UNAVAILABLE";
            killComplete = true;
            maybeFinish();
          }
        }
      };
      void startWorker();
    });
    entry.promise = task.finally(() => active.delete(entry));
    return entry.promise;
  }

  async function preflight(options = {}) {
    if (!validOptions(options, ["auditRequest", "signal", "budgetMs"])) {
      return safePreflight(SAFE_MESSAGES.INVALID_REQUEST);
    }
    const { auditRequest, signal, budgetMs } = options;
    try {
      const result = await run("preflight", auditRequest, { signal, budgetMs });
      const checkedAt = new Date().toISOString();
      return validatePreflight(result, checkedAt)
        ? result
        : safePreflight(SAFE_MESSAGES.INVALID_RESPONSE);
    } catch (error) {
      const code = error instanceof OmpHostError && SAFE_CODES.has(error.code) ? error.code : "INVALID_RESPONSE";
      return safePreflight(SAFE_MESSAGES[code]);
    }
  }

  function call(request, options = {}) {
    return run("call", request, options);
  }

  function abort() {
    const running = [...active];
    for (const entry of running) entry.stop?.("ABORTED");
    return Promise.allSettled(running.map(entry => entry.promise));
  }

  function close() {
    if (closePromise) return closePromise;
    closed = true;
    closePromise = abort();
    return closePromise;
  }

  return Object.freeze({ preflight, call, abort, close });
}
