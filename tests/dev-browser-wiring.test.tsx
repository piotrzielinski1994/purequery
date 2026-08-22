import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/runtime/environment", () => ({
  isDevBrowser: vi.fn(),
}));

import { AppProviders } from "@/app/providers";
import { isDevBrowser } from "@/lib/runtime/environment";
import { rootRoute } from "@/routes/__root";
import { indexRoute } from "@/routes/index";

const mockedIsDevBrowser = vi.mocked(isDevBrowser);

function renderApp() {
  const testRouter = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  return render(
    <AppProviders>
      <RouterProvider router={testRouter} />
    </AppProviders>,
  );
}

afterEach(() => {
  cleanup();
  mockedIsDevBrowser.mockReset();
});

describe("dev-browser wiring (AC-103 / F4)", () => {
  it("should load the demo workspace when isDevBrowser is true", async () => {
    mockedIsDevBrowser.mockReturnValue(true);
    renderApp();

    expect(await screen.findByText("Chinook")).toBeInTheDocument();
    expect(
      screen.getByRole("tree", { name: /navigator/i }),
    ).toBeInTheDocument();
  });

  it("should keep the open-workspace prompt when isDevBrowser is false", async () => {
    mockedIsDevBrowser.mockReturnValue(false);
    renderApp();

    expect(
      await screen.findByRole("button", { name: /open workspace folder/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Chinook")).not.toBeInTheDocument();
  });
});
