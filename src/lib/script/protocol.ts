import type { DbEngine } from "@/lib/workspace/model";

// The read-only `db` methods a script can call over the RPC bridge. SQL engines use
// `query`/`tables`/`schema`; MongoDB uses `find`/`aggregate`/`collections`/`schema`.
export type ScriptMethod =
  | "query"
  | "tables"
  | "schema"
  | "find"
  | "aggregate"
  | "collections";

// Messages the worker posts to the main thread.
export type ScriptRpc =
  | { kind: "rpc"; id: string; method: string; args: unknown[] }
  | { kind: "log"; level: "log" | "error"; text: string }
  | { kind: "done"; value: unknown }
  | { kind: "error"; message: string };

// Messages the main thread posts back to the worker.
export type ScriptReply =
  | { kind: "start"; code: string; engine: DbEngine }
  | { kind: "reply"; id: string; result?: unknown; error?: string };
