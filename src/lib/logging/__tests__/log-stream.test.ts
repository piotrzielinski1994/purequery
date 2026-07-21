import { describe, expect, it, vi } from "vitest";

import { createNoopLogStream } from "@/lib/logging/log-stream";

describe("createNoopLogStream", () => {
  // behavior: the noop stream never emits a line and resolves to a callable unsubscribe.
  it("should resolve an unsubscribe and never call the listener", async () => {
    const onLine = vi.fn();
    const unsubscribe = await createNoopLogStream().subscribe(onLine);

    expect(onLine).not.toHaveBeenCalled();
    expect(() => unsubscribe()).not.toThrow();
  });
});
