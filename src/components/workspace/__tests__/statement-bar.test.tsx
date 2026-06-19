import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { StatementBar } from "@/components/workspace/statement-bar";
import { fixtureTree } from "@/components/workspace/__tests__/fixtures";

function renderBar(activeQueryId?: string) {
  return render(
    <WorkspaceProvider tree={fixtureTree} initialActiveQueryId={activeQueryId}>
      <StatementBar />
    </WorkspaceProvider>,
  );
}

describe("StatementBar", () => {
  // AC-008 — behavior
  it("should expose a group named statement bar", () => {
    renderBar("q-active-users");
    expect(
      screen.getByRole("group", { name: /statement bar/i }),
    ).toBeInTheDocument();
  });

  // AC-008, TC-003 — behavior
  it("should show the active query's statement kind", () => {
    renderBar("q-active-users");
    const bar = screen.getByRole("group", { name: /statement bar/i });
    expect(bar).toHaveTextContent(/SELECT/);
  });

  // AC-008, TC-003 — behavior
  it("should show the active query's target in a read-only target textbox", () => {
    renderBar("q-active-users");
    expect(screen.getByRole("textbox", { name: /target/i })).toHaveTextContent(
      "{{db}}.public.active_users",
    );
  });

  // AC-008 — behavior
  it("should render an inert Run button when a query is active", () => {
    renderBar("q-active-users");
    expect(screen.getByRole("button", { name: /run/i })).toBeInTheDocument();
  });

  // AC-008 — behavior
  it("should reflect a different active query's kind and target", () => {
    renderBar("q-purge-sessions");
    const bar = screen.getByRole("group", { name: /statement bar/i });
    expect(bar).toHaveTextContent(/DELETE/);
    expect(screen.getByRole("textbox", { name: /target/i })).toHaveTextContent(
      "{{db}}.public.sessions",
    );
  });

  // E-1 — behavior
  it("should show an empty state when no query is active", () => {
    renderBar(undefined);
    expect(screen.getByText(/no query selected/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: /target/i }),
    ).not.toBeInTheDocument();
  });
});
