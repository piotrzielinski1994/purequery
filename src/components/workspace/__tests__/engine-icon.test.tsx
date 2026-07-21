import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EngineIcon } from "@/components/workspace/engine-icon";
import type { DbEngine } from "@/lib/workspace/model";

describe("EngineIcon", () => {
  // TC-002 - behavior (each engine renders a distinct brand glyph, identified by its testid)
  it("should render a distinct icon per engine", () => {
    const engines: DbEngine[] = [
      "postgres",
      "mysql",
      "sqlite",
      "mongodb",
      "sqlserver",
      "dynamodb",
    ];
    const testIds = engines.map((engine) => {
      const { container } = render(<EngineIcon engine={engine} />);
      const svg = container.querySelector("svg");
      return svg?.getAttribute("data-engine");
    });
    expect(testIds).toEqual([
      "postgres",
      "mysql",
      "sqlite",
      "mongodb",
      "sqlserver",
      "dynamodb",
    ]);
  });

  // behavior (monochrome: the glyph inherits the current text color, never a brand color)
  it("should render the glyph in the current text color, not a brand color", () => {
    const { container } = render(<EngineIcon engine="postgres" />);
    const svg = container.querySelector("svg");
    // simple-icons render with fill="currentColor" by default - no hard-coded hex/brand fill.
    expect(svg?.getAttribute("fill")).toBe("currentColor");
  });

  // behavior (passes through className so callers keep size/color utility classes)
  it("should apply the passed className", () => {
    const { container } = render(
      <EngineIcon
        engine="mongodb"
        className="size-3.5 text-muted-foreground"
      />,
    );
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("class")).toContain("size-3.5");
  });
});
