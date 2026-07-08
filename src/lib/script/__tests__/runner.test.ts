import { describe, it, expect } from "vitest";

import { createNoopRunner } from "@/lib/script/runner";

// The noop runner is the browser/test stand-in for the real Worker-backed runner (mirrors
// createNoopWindowController). It must satisfy the ScriptRunner port shape without spawning a worker.
describe("createNoopRunner", () => {
  // AC-002, AC-012 - behavior (the noop runner exposes the ScriptRunner port surface)
  it("should expose run and terminate methods", () => {
    const runner = createNoopRunner();
    expect(typeof runner.run).toBe("function");
    expect(typeof runner.terminate).toBe("function");
  });

  // AC-002, AC-012 - behavior (the noop runner never drives any handler and never throws)
  it("should not invoke any handler and not throw when run/terminate are called", () => {
    const runner = createNoopRunner();
    const calls: string[] = [];

    expect(() =>
      runner.run("return 1", "postgres", {
        onLog: () => calls.push("log"),
        onRpc: () => calls.push("rpc"),
        onDone: () => calls.push("done"),
        onError: () => calls.push("error"),
      }),
    ).not.toThrow();
    expect(() => runner.terminate()).not.toThrow();

    expect(calls).toEqual([]);
  });
});
