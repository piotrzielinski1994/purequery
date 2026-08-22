import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import config from "../playwright.config";

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? walk(`${dir}/${entry.name}`)
      : [`${dir}/${entry.name}`],
  );
}

const testMatch = config.testMatch as RegExp;
const vitestSpecs = [...walk("tests"), ...walk("src")].filter((file) =>
  /\.(test|spec)\.(ts|tsx)$/.test(file),
);
const e2eSpecs = walk("tests/e2e").filter((file) => file.endsWith(".e2e.ts"));

describe("vitest/playwright disjointness (AC-106 / F4)", () => {
  it("should have vitest specs that playwright never picks up", () => {
    expect(vitestSpecs.length).toBeGreaterThan(0);
    for (const file of vitestSpecs) {
      expect(testMatch.test(file), file).toBe(false);
    }
  });

  it("should match exactly the e2e specs on disk", () => {
    expect(e2eSpecs.length).toBeGreaterThan(0);
    for (const file of e2eSpecs) {
      expect(testMatch.test(file), file).toBe(true);
    }
  });

  it("should not pick up tests/e2e/bootstrap.spec.tsx (a Vitest spec)", () => {
    expect(
      vitestSpecs.some((file) => file.includes("tests/e2e/bootstrap.spec")),
    ).toBe(true);
    expect(testMatch.test("tests/e2e/bootstrap.spec.tsx")).toBe(false);
  });

  it("should keep e2e out of the vitest include", () => {
    const vitestConfigSrc = readFileSync("vitest.config.ts", "utf8");
    expect(vitestConfigSrc).not.toMatch(/include[^\n]*["'/]e2e/);
  });
});
