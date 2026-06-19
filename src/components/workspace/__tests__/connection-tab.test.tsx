import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { ConnectionTab } from "@/components/workspace/connection-tab";
import { fixtureTree } from "@/components/workspace/__tests__/fixtures";

function renderConnection(activeTabId?: string) {
  return render(
    <WorkspaceProvider tree={fixtureTree} initialActiveTabId={activeTabId}>
      <ConnectionTab />
    </WorkspaceProvider>,
  );
}

describe("ConnectionTab", () => {
  // AC-014, TC-006 — behavior (token variant)
  it("should show a token textbox with the token value for a token connection", () => {
    renderConnection("db-app");
    expect(screen.getByRole("textbox", { name: /token/i })).toHaveValue(
      "tok-abc-123",
    );
  });

  // AC-014 — behavior (password variant: username + masked password)
  it("should show username and a masked password field for a password connection", () => {
    renderConnection("db-admin");
    expect(screen.getByRole("textbox", { name: /username/i })).toHaveValue(
      "seed_admin",
    );
    const password = screen.getByLabelText("Password", { exact: true });
    expect(password).toHaveAttribute("type", "password");
  });

  // AC-012 — behavior (password reveal toggle)
  it("should reveal the password as plain text when the show-password button is clicked", async () => {
    const user = userEvent.setup();
    renderConnection("db-admin");

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

  // AC-014 — behavior (none variant)
  it("should show a no-auth message for a none connection", () => {
    renderConnection("db-scratch");
    expect(screen.getByText(/no connection|no auth/i)).toBeInTheDocument();
  });
});
