import { describe, it, expect } from "vitest";

import { toResult } from "@/lib/result";

describe("toResult", () => {
  // TC-002, AC-004 - behavior
  it("should resolve to { ok: true, value } if the promise fulfills", async () => {
    const result = await toResult(Promise.resolve(42));

    expect(result).toEqual({ ok: true, value: 42 });
  });

  // TC-002, AC-004 - behavior
  it("should preserve the resolved value verbatim if the promise fulfills", async () => {
    const payload = { tables: ["a", "b", "c"] };

    const result = await toResult(Promise.resolve(payload));

    expect(result).toEqual({ ok: true, value: payload });
  });

  // TC-002, AC-004 - behavior
  it("should resolve to { ok: false, error: message } if the promise rejects with an Error", async () => {
    const result = await toResult(Promise.reject(new Error("boom")));

    expect(result).toEqual({ ok: false, error: "boom" });
  });

  // TC-002, AC-004, E-4 - behavior
  it("should stringify a non-Error rejection value into the error field", async () => {
    const result = await toResult(Promise.reject("plain failure"));

    expect(result).toEqual({ ok: false, error: "plain failure" });
  });

  // TC-002, AC-004, E-4 - behavior
  it("should stringify a non-string non-Error rejection value into the error field", async () => {
    const result = await toResult(Promise.reject(503));

    expect(result).toEqual({ ok: false, error: "503" });
  });
});
