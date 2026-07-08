import { describe, it, expect } from "vitest";

import { isWriteSql } from "@/lib/script/dispatch";

// The write keywords the read-only guard rejects when they lead the statement (AC-006 / TC-003).
const WRITE_KEYWORDS = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "DROP",
  "ALTER",
  "CREATE",
  "TRUNCATE",
  "REPLACE",
  "MERGE",
  "GRANT",
  "REVOKE",
];

describe("isWriteSql leading write keywords", () => {
  // AC-006, TC-003 - behavior (every documented write keyword leading the statement is write-shaped)
  for (const keyword of WRITE_KEYWORDS) {
    it(`should treat a leading ${keyword} statement as write-shaped`, () => {
      expect(isWriteSql(`${keyword} something here`)).toBe(true);
    });
  }

  // AC-006 - behavior (detection is case-insensitive)
  it("should treat a lowercase update as write-shaped", () => {
    expect(isWriteSql("update users set name='x' where id=1")).toBe(true);
  });

  // AC-006 - behavior (mixed case is still detected)
  it("should treat a mixed-case InSeRt as write-shaped", () => {
    expect(isWriteSql("InSeRt INTO t VALUES (1)")).toBe(true);
  });
});

describe("isWriteSql read statements", () => {
  // AC-006, TC-003 - behavior (a leading SELECT is a read, never blocked)
  it("should treat a leading SELECT as read (not write)", () => {
    expect(isWriteSql("SELECT id, name FROM users")).toBe(false);
  });

  // AC-006 - behavior (a leading WITH read CTE is not write-shaped)
  it("should treat a leading WITH read as not write-shaped", () => {
    expect(isWriteSql("WITH t AS (SELECT 1) SELECT * FROM t")).toBe(false);
  });

  // AC-006 - behavior (a column whose name merely starts with a keyword substring is still a read)
  it("should not flag a SELECT of an updated_at column as write-shaped", () => {
    expect(isWriteSql("SELECT updated_at FROM t")).toBe(false);
  });

  // AC-006 - behavior (empty input is not write-shaped)
  it("should treat an empty string as not write-shaped", () => {
    expect(isWriteSql("")).toBe(false);
  });

  // AC-006 - behavior (whitespace only is not write-shaped)
  it("should treat a whitespace-only string as not write-shaped", () => {
    expect(isWriteSql("   \n\t ")).toBe(false);
  });
});

describe("isWriteSql comment + whitespace stripping", () => {
  // AC-006, TC-003 - behavior (leading whitespace/newlines before the keyword are stripped)
  it("should detect a write keyword after leading whitespace and newlines", () => {
    expect(isWriteSql("\n\n   \tINSERT INTO t VALUES (1)")).toBe(true);
  });

  // AC-006, TC-003 - behavior (a leading line comment is stripped, then the keyword is detected)
  it("should detect an UPDATE after a leading line comment", () => {
    expect(isWriteSql("-- comment\nUPDATE t SET a = 1")).toBe(true);
  });

  // AC-006, TC-003 - behavior (a leading block comment is stripped, then the keyword is detected)
  it("should detect a DELETE after a leading block comment", () => {
    expect(isWriteSql("/* wipe it */ DELETE FROM t")).toBe(true);
  });

  // AC-006, TC-003 - behavior (prefix-only: a write keyword only in a TRAILING comment is not a write)
  it("should NOT flag a SELECT whose only UPDATE is inside a trailing comment", () => {
    expect(isWriteSql("select 1 -- update x")).toBe(false);
  });

  // AC-006 - behavior (a leading comment followed only by a SELECT is still a read)
  it("should treat a leading comment before a SELECT as read", () => {
    expect(isWriteSql("-- daily report\nSELECT count(*) FROM t")).toBe(false);
  });
});
