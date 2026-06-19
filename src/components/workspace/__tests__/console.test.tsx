import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { Console } from "@/components/workspace/console";
import {
  fixtureTree,
  fixtureConsoleLines,
} from "@/components/workspace/__tests__/fixtures";

describe("Console", () => {
  // AC-012 — behavior
  it("should expose a console region", () => {
    render(
      <WorkspaceProvider tree={fixtureTree} consoleLines={fixtureConsoleLines}>
        <Console />
      </WorkspaceProvider>,
    );
    expect(
      screen.getByRole("region", { name: /console/i }),
    ).toBeInTheDocument();
  });

  // AC-012 — behavior
  it("should render each mock log line as text inside the console region", () => {
    render(
      <WorkspaceProvider tree={fixtureTree} consoleLines={fixtureConsoleLines}>
        <Console />
      </WorkspaceProvider>,
    );
    const region = screen.getByRole("region", { name: /console/i });
    for (const line of fixtureConsoleLines) {
      expect(within(region).getByText(line)).toBeInTheDocument();
    }
  });
});
