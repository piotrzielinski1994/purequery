import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { SettingsTab } from "@/components/workspace/settings-tab";
import { fixtureTree } from "@/components/workspace/__tests__/fixtures";

function renderSettings(activeTabId?: string) {
  return render(
    <WorkspaceProvider tree={fixtureTree} initialActiveTabId={activeTabId}>
      <SettingsTab />
    </WorkspaceProvider>,
  );
}

describe("SettingsTab", () => {
  // AC-014 — behavior (host / port / database)
  it("should show the host, port and database of the active database", () => {
    renderSettings("db-admin");
    expect(screen.getByRole("textbox", { name: /host/i })).toHaveValue(
      "db.internal",
    );
    expect(screen.getByRole("textbox", { name: /port/i })).toHaveValue("5433");
    expect(screen.getByRole("textbox", { name: /database/i })).toHaveValue(
      "admin",
    );
  });

  // AC-014 — behavior (user + masked password)
  it("should show the user and a masked password field", () => {
    renderSettings("db-admin");
    expect(screen.getByRole("textbox", { name: /user/i })).toHaveValue(
      "seed_admin",
    );
    const password = screen.getByLabelText("Password", { exact: true });
    expect(password).toHaveAttribute("type", "password");
  });

  // AC-014 — behavior (password reveal toggle)
  it("should reveal the password as plain text when the show-password button is clicked", async () => {
    const user = userEvent.setup();
    renderSettings("db-admin");

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
});
