import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { QueryPane } from "@/components/workspace/query-pane";
import { fixtureTree } from "@/components/workspace/__tests__/fixtures";

function renderPane(activeQueryId?: string) {
  return render(
    <WorkspaceProvider tree={fixtureTree} initialActiveQueryId={activeQueryId}>
      <QueryPane />
    </WorkspaceProvider>,
  );
}

describe("QueryPane", () => {
  // AC-009 — behavior
  it("should expose a query-sections tablist with all five section tabs", () => {
    renderPane("q-active-users");
    const tablist = screen.getByRole("tablist", { name: /query sections/i });
    expect(tablist).toBeInTheDocument();
    for (const name of ["SQL", "Params", "Options", "Connection", "Script"]) {
      expect(screen.getByRole("tab", { name })).toBeInTheDocument();
    }
  });

  // AC-009 — behavior
  it("should show the SQL text in the default SQL section", () => {
    renderPane("q-active-users");
    expect(
      screen.getByText(/SELECT id, name, email FROM active_users/),
    ).toBeInTheDocument();
  });

  // TC-004 / AC-009 — behavior
  it("should show the params panel when the Params tab is clicked", async () => {
    const user = userEvent.setup();
    renderPane("q-active-users");

    await user.click(screen.getByRole("tab", { name: "Params" }));

    expect(screen.getByText("limit")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.getByText("since")).toBeInTheDocument();
  });

  // AC-009 — behavior
  it("should show the options panel when the Options tab is clicked", async () => {
    const user = userEvent.setup();
    renderPane("q-active-users");

    await user.click(screen.getByRole("tab", { name: "Options" }));

    expect(screen.getByText("timeout")).toBeInTheDocument();
    expect(screen.getByText("30s")).toBeInTheDocument();
  });

  // TC-004 / AC-011 — behavior (token variant)
  it("should show a token textbox with the token value for a token connection", async () => {
    const user = userEvent.setup();
    renderPane("q-active-users");

    await user.click(screen.getByRole("tab", { name: "Connection" }));

    expect(screen.getByRole("textbox", { name: /token/i })).toHaveValue(
      "tok-abc-123",
    );
  });

  // AC-011 — behavior (password variant)
  it("should show username and a masked password field for a password connection", async () => {
    const user = userEvent.setup();
    renderPane("q-seed-users");

    await user.click(screen.getByRole("tab", { name: "Connection" }));

    expect(screen.getByRole("textbox", { name: /username/i })).toHaveValue(
      "seed_admin",
    );
    const password = screen.getByLabelText("Password", { exact: true });
    expect(password).toHaveAttribute("type", "password");
  });

  // AC-011 — behavior (password reveal toggle)
  it("should reveal the password as plain text when the show-password button is clicked", async () => {
    const user = userEvent.setup();
    renderPane("q-seed-users");

    await user.click(screen.getByRole("tab", { name: "Connection" }));
    expect(screen.getByLabelText("Password", { exact: true })).toHaveAttribute(
      "type",
      "password",
    );

    await user.click(screen.getByRole("button", { name: /show password/i }));

    expect(screen.getByLabelText("Password", { exact: true })).toHaveAttribute(
      "type",
      "text",
    );
  });

  // AC-011 — behavior (none variant)
  it("should show a no-auth message for a none connection", async () => {
    const user = userEvent.setup();
    renderPane("q-purge-sessions");

    await user.click(screen.getByRole("tab", { name: "Connection" }));

    expect(screen.getByText(/no connection|no auth/i)).toBeInTheDocument();
  });

  // E-1 — behavior
  it("should show an empty state when no query is active", () => {
    renderPane(undefined);
    expect(screen.getByText(/no query selected/i)).toBeInTheDocument();
  });
});
