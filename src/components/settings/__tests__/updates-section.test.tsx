import {
  type UpdateController,
  type UpdateInfo,
  UpdatesSection,
} from "@pziel/pureui";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSonnerUpdateToastSink } from "@/lib/updater/update-toast-sink";

// R18 consume-integration: purequery no longer owns UpdatesSection - it renders
// the hoisted pureui section wired with its REAL sonner sink
// (createSonnerUpdateToastSink, untouched) plus the two one-shot messages routed
// { info: toast, error: toast.error } so the FAILED message stays error-styled.
// sonner is the observable boundary (mocked); the controller + version source are
// injected as props from the SettingsPage call site (useUpdater()).

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

const mockToast = vi.mocked(toast);

function makeUpdate(version = "0.2.0"): UpdateInfo {
  return {
    version,
    downloadAndInstall: vi.fn(async () => {}),
    relaunch: vi.fn(async () => {}),
  };
}

function renderSection(opts: {
  check: () => Promise<UpdateInfo | null>;
  version?: string;
}): { controller: UpdateController & { check: ReturnType<typeof vi.fn> } } {
  const controller = { check: vi.fn(opts.check) };
  render(
    <UpdatesSection
      controller={controller}
      getVersion={async () => opts.version ?? "1.2.3"}
      sink={createSonnerUpdateToastSink()}
      notify={{ info: toast, error: toast.error }}
    />,
  );
  return { controller };
}

describe("UpdatesSection (purequery consume)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // behavior (TC-010): the current version from the injected source is shown
  it("should render the current app version from the version source", async () => {
    renderSection({ check: async () => null, version: "1.4.2" });

    await waitFor(() => {
      expect(screen.getByText(/1\.4\.2/)).toBeInTheDocument();
    });
  });

  // side-effect-contract (TC-010): a manual check with no update routes the
  // latest-version message through plain sonner `toast`
  it("should show a latest-version toast if the manual check finds no update", async () => {
    const user = userEvent.setup();
    const { controller } = renderSection({ check: async () => null });

    const button = await screen.findByRole("button", {
      name: /check for updates/i,
    });
    await user.click(button);

    await waitFor(() => {
      expect(controller.check).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(
        mockToast.mock.calls.some((c) => /latest version/i.test(String(c[0]))),
      ).toBe(true);
    });
    await waitFor(() => {
      expect(button).not.toBeDisabled();
    });
  });

  // side-effect-contract (TC-010): a manual check that finds an update drives the
  // update toast through the sonner sink (message carries the version)
  it("should show the update toast if the manual check finds an available update", async () => {
    const user = userEvent.setup();
    renderSection({ check: async () => makeUpdate("0.2.0") });

    const button = await screen.findByRole("button", {
      name: /check for updates/i,
    });
    await user.click(button);

    await waitFor(() => {
      expect(
        mockToast.mock.calls.some((c) => /0\.2\.0/.test(String(c[0]))),
      ).toBe(true);
    });
  });

  // side-effect-contract (TC-010): a rejected manual check routes the FAILED
  // message through toast.error (error-styled), and re-enables the button
  it("should show a check-failed error toast and re-enable the button if the check rejects", async () => {
    const user = userEvent.setup();
    renderSection({
      check: async () => {
        throw new Error("offline");
      },
    });

    const button = await screen.findByRole("button", {
      name: /check for updates/i,
    });
    await user.click(button);

    await waitFor(() => {
      expect(
        (
          mockToast.error as unknown as ReturnType<typeof vi.fn>
        ).mock.calls.some((c) => /update check failed/i.test(String(c[0]))),
      ).toBe(true);
    });
    // the plain toast never carried the failure - it is error-styled
    expect(
      mockToast.mock.calls.some((c) =>
        /update check failed/i.test(String(c[0])),
      ),
    ).toBe(false);
    await waitFor(() => {
      expect(button).not.toBeDisabled();
    });
  });

  // behavior (TC-010): while a check is in flight the button is disabled and a
  // second click does not start a second check
  it("should disable the button in flight and ignore a second click", async () => {
    const user = userEvent.setup();
    let resolveCheck: (value: UpdateInfo | null) => void = () => {};
    const pending = new Promise<UpdateInfo | null>((resolve) => {
      resolveCheck = resolve;
    });
    const { controller } = renderSection({ check: () => pending });

    const button = await screen.findByRole("button", {
      name: /check for updates/i,
    });
    await user.click(button);

    await waitFor(() => {
      expect(button).toBeDisabled();
    });
    await user.click(button).catch(() => {});
    expect(controller.check).toHaveBeenCalledTimes(1);

    resolveCheck(null);
    await waitFor(() => {
      expect(button).not.toBeDisabled();
    });
  });

  // behavior (TC-010 UI state): the in-flight label reads Checking…
  it("should show a Checking… label while a check is in flight", async () => {
    const user = userEvent.setup();
    const pending = new Promise<UpdateInfo | null>(() => {});
    renderSection({ check: () => pending });

    const button = await screen.findByRole("button", {
      name: /check for updates/i,
    });
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByText(/checking…/i)).toBeInTheDocument();
    });
  });
});
