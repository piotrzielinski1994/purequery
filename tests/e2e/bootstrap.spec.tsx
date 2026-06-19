import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  createRouter,
  createMemoryHistory,
  RouterProvider,
} from "@tanstack/react-router";

import { AppProviders } from "@/app/providers";
import { rootRoute } from "@/routes/__root";
import { indexRoute } from "@/routes/index";
import { settingsRoute } from "@/routes/settings";

function renderApp(initialPath = "/") {
  const routeTree = rootRoute.addChildren([indexRoute, settingsRoute]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });

  return render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );
}

describe("workspace routing", () => {
  // TC-001 / AC-001, AC-002 — behavior
  it("should render the workspace sidebar tree at the home route", async () => {
    renderApp("/");
    expect(
      await screen.findByRole("tree", { name: /navigator/i }),
    ).toBeInTheDocument();
  });

  // AC-001, AC-012 — behavior
  it("should render the console region at the home route", async () => {
    renderApp("/");
    expect(
      await screen.findByRole("region", { name: /console/i }),
    ).toBeInTheDocument();
  });

  // AC-015 — behavior (bootstrap demo nav removed)
  it("should not render the old bootstrap home nav link", async () => {
    renderApp("/");
    await screen.findByRole("tree", { name: /navigator/i });
    expect(
      screen.queryByRole("link", { name: /^home$/i }),
    ).not.toBeInTheDocument();
  });

  // AC-015 — behavior (command palette removed)
  it("should not render a command palette dialog", async () => {
    renderApp("/");
    await screen.findByRole("tree", { name: /navigator/i });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // E-6 — behavior (settings route exists, no in-UI link)
  it("should still render the settings route content", async () => {
    renderApp("/settings");
    expect(
      await screen.findByText(/configuration lives here/i),
    ).toBeInTheDocument();
  });

  // E-6 — behavior (no in-UI link to settings on the home view)
  it("should not render an in-UI settings link on the home view", async () => {
    renderApp("/");
    await screen.findByRole("tree", { name: /navigator/i });
    expect(
      screen.queryByRole("link", { name: /^settings$/i }),
    ).not.toBeInTheDocument();
  });

  // AC-001 — behavior (unknown route -> 404)
  it("should render a not-found view for an unknown route", async () => {
    renderApp("/this-route-does-not-exist");
    expect(await screen.findByText(/404/i)).toBeInTheDocument();
    expect(screen.getByText(/does not exist/i)).toBeInTheDocument();
  });
});
