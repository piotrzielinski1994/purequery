import type { ScriptRpc } from "@/lib/script/protocol";
import type { DbEngine } from "@/lib/workspace/model";

// The reply a host returns for one `db.*` RPC: either a result value or an error string (a
// read-only-guard rejection or a backend failure). The worker resolves/rejects the script's `await`.
export type RpcReply = { result?: unknown; error?: string };

// Callbacks the runner drives from the worker's messages. `onRpc` performs the mapped (read-only)
// Tauri call and resolves to the reply the worker posts back to the script's awaiting promise; its
// return is typed loosely (`unknown`, adopted via Promise.resolve) so a plain stub handler satisfies
// the port without wrapping every reply in a promise.
export type ScriptHandlers = {
  onLog: (level: "log" | "error", text: string) => void;
  onRpc: (id: string, method: string, args: unknown[]) => unknown;
  onDone: (value: unknown) => void;
  onError: (message: string) => void;
};

// Port for running a user script. The real build spawns a Web Worker (isolating a runaway loop from
// the UI thread + a true `terminate()` cancel); browser/test builds use the noop. Kept behind a port
// so the Script tab is unit-testable with an injected fake, mirroring `WindowController`.
export type ScriptRunner = {
  run: (code: string, engine: DbEngine, handlers: ScriptHandlers) => void;
  terminate: () => void;
};

export function createNoopRunner(): ScriptRunner {
  return {
    run: () => {},
    terminate: () => {},
  };
}

// The real runner: one Worker per run. The worker posts `rpc`/`log`/`done`/`error`; we map each to a
// handler and, for an `rpc`, post the awaited reply back keyed by id. `terminate()` kills the worker
// (drops any in-flight RPC - the worker is gone, so its pending promises never resolve).
export function createWorkerRunner(): ScriptRunner {
  let worker: Worker | null = null;
  return {
    run: (code, engine, handlers) => {
      worker?.terminate();
      const next = new Worker(new URL("./worker.ts", import.meta.url), {
        type: "module",
      });
      worker = next;
      next.onmessage = (event: MessageEvent<ScriptRpc>) => {
        const message = event.data;
        if (message.kind === "log") {
          handlers.onLog(message.level, message.text);
          return;
        }
        if (message.kind === "done") {
          handlers.onDone(message.value);
          return;
        }
        if (message.kind === "error") {
          handlers.onError(message.message);
          return;
        }
        void Promise.resolve(
          handlers.onRpc(message.id, message.method, message.args),
        )
          .then((reply) => reply as RpcReply)
          // A rejected onRpc must still post a reply, or the worker awaits one that never comes
          // (deadlock -> the run hangs forever). Convert it to an error reply.
          .catch(
            (error): RpcReply => ({
              error: error instanceof Error ? error.message : String(error),
            }),
          )
          .then((reply) =>
            next.postMessage({ kind: "reply", id: message.id, ...reply }),
          );
      };
      next.postMessage({ kind: "start", code, engine });
    },
    terminate: () => {
      worker?.terminate();
      worker = null;
    },
  };
}
