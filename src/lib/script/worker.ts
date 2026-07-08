/// <reference lib="webworker" />
import type { ScriptReply } from "@/lib/script/protocol";

// The worker sandbox for a user script. It receives a `start` message with the code + engine, wraps
// the code in an AsyncFunction with `db`/`console`/`print` injected, and runs it. Every `db.*` call
// and each `console`/`print` posts a message to the main thread; a `db.*` call awaits the matching
// `reply`. All DB work + the read-only guard live on the main thread (ScriptHost) - this file is a
// thin, isolated executor so a runaway loop burns THIS thread, not the UI, and `terminate()` cancels.

let nextId = 0;
const pending = new Map<string, (reply: { result?: unknown; error?: string }) => void>();

function post(message: unknown) {
  (self as DedicatedWorkerGlobalScope).postMessage(message);
}

function rpc(method: string, args: unknown[]): Promise<unknown> {
  const id = `rpc-${nextId++}`;
  return new Promise((resolve, reject) => {
    pending.set(id, (reply) => {
      if (reply.error !== undefined) {
        reject(new Error(reply.error));
        return;
      }
      resolve(reply.result);
    });
    post({ kind: "rpc", id, method, args });
  });
}

// The injected `db` API - read-only. SQL engines get query/tables/schema; Mongo gets
// find/aggregate/collections/schema. Every method is a thin RPC to the main thread.
const scriptDb = {
  query: (sql: string) => rpc("query", [sql]),
  tables: () => rpc("tables", []),
  collections: () => rpc("collections", []),
  schema: () => rpc("schema", []),
  find: (collection: string, filter?: unknown) =>
    rpc("find", [collection, filter ?? {}]),
  aggregate: (collection: string, pipeline: unknown) =>
    rpc("aggregate", [collection, pipeline]),
};

function stringify(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
}

const consoleShim = {
  log: (...parts: unknown[]) =>
    post({ kind: "log", level: "log", text: parts.map(stringify).join(" ") }),
  error: (...parts: unknown[]) =>
    post({ kind: "log", level: "error", text: parts.map(stringify).join(" ") }),
};

async function execute(code: string) {
  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {})
      .constructor as new (...args: string[]) => (
      db: typeof scriptDb,
      console: typeof consoleShim,
      print: (value: unknown) => void,
    ) => Promise<unknown>;
    const fn = new AsyncFunction("db", "console", "print", code);
    const value = await fn(scriptDb, consoleShim, (v) => consoleShim.log(v));
    post({ kind: "done", value });
  } catch (error) {
    post({
      kind: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

self.onmessage = (event: MessageEvent<ScriptReply>) => {
  const message = event.data;
  if (message.kind === "start") {
    void execute(message.code);
    return;
  }
  const resolver = pending.get(message.id);
  if (resolver) {
    pending.delete(message.id);
    resolver({ result: message.result, error: message.error });
  }
};
