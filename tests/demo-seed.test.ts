import { describe, expect, it } from "vitest";
import {
  DEMO_WORKSPACE_PATH,
  demoFiles,
  demoSettings,
} from "@/lib/workspace/demo-seed";
import { deserialize } from "@/lib/workspace/disk-format";

describe("demo-seed (AC-102 / F4)", () => {
  it("should round-trip through the real deserialize path", () => {
    const parsed = deserialize(demoFiles());

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const names = parsed.tree.map((node) => node.name);
    expect(names).toContain("demos");
    expect(names).toContain("Chinook");
  });

  it("should keep the seeded database through the loader shape", () => {
    const parsed = deserialize(demoFiles());

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const chinook = parsed.tree.find((node) => node.name === "Chinook");
    // Tables are live-catalog data and are intentionally dropped by the disk
    // format; only the persisted database node survives the round trip.
    expect(chinook?.kind).toBe("database");
  });

  it("should return settings pointing at the demo workspace path", () => {
    const settings = demoSettings();

    expect(settings.workspacePath).toBe(DEMO_WORKSPACE_PATH);
  });
});
