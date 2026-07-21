import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  expandedToAppDb,
  fixtureTree,
} from "@/components/workspace/__tests__/fixtures";
import { ContentHeader } from "@/components/workspace/content-header";
import { SettingsTab } from "@/components/workspace/settings-tab";
import { SidebarTree } from "@/components/workspace/sidebar-tree";
import { __resetInFlightConnects } from "@/components/workspace/use-connection";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { cancelConnect, connectDatabase } from "@/lib/tauri";
import type { ConnectionConfig } from "@/lib/workspace/model";

vi.mock("@/lib/tauri", () => ({
  connectDatabase: vi.fn(),
  fetchSchema: vi.fn(() => Promise.resolve([])),
  cancelConnect: vi.fn(),
  disconnectDatabase: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const mockConnect = vi.mocked(connectDatabase);
const mockCancelConnect = vi.mocked(cancelConnect);

const adminConfig: ConnectionConfig = {
  engine: "postgres",
  host: "localhost",
  port: 5432,
  database: "admin",
  user: "postgres",
  password: "postgres",
};

function renderTree(opts?: {
  expanded?: string[];
  activeTabId?: string;
  connected?: string[];
  connections?: [string, ConnectionConfig][];
  children?: ReactNode;
}) {
  return render(
    <WorkspaceProvider
      tree={fixtureTree}
      initialExpandedIds={opts?.expanded ?? []}
      initialActiveTabId={opts?.activeTabId}
      initialConnectionStatus={(opts?.connected ?? []).map((id) => [
        id,
        "connected",
      ])}
      initialConnections={opts?.connections}
    >
      <SidebarTree />
      {opts?.children}
    </WorkspaceProvider>,
  );
}

describe("SidebarTree", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetInFlightConnects();
  });

  // AC-002 — behavior
  it("should expose a tree landmark named navigator", () => {
    renderTree();
    expect(
      screen.getByRole("tree", { name: /navigator/i }),
    ).toBeInTheDocument();
  });

  // AC-002 — behavior
  it("should render root folders and a root-level database leaf as treeitems", () => {
    renderTree();
    expect(screen.getByRole("treeitem", { name: "prod" })).toBeInTheDocument();
    expect(
      screen.getByRole("treeitem", { name: "staging" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("treeitem", { name: "scratch_db" }),
    ).toBeInTheDocument();
  });

  // AC-002 — behavior (database name carries no kind prefix)
  it("should name a database treeitem by the database name with no kind prefix", () => {
    renderTree({ expanded: expandedToAppDb });
    expect(
      screen.getByRole("treeitem", { name: "app_db" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("treeitem", { name: /database app_db/i }),
    ).not.toBeInTheDocument();
  });

  // AC-002, E-9 — behavior (database two folders deep)
  it("should reveal a database nested two folders deep when all ancestors are expanded", () => {
    renderTree({ expanded: expandedToAppDb });
    expect(
      screen.getByRole("treeitem", { name: "app_db" }),
    ).toBeInTheDocument();
  });

  // AC-003 — behavior
  it("should hide a folder's children from the DOM when the folder is collapsed", () => {
    renderTree({ expanded: [] });
    expect(
      screen.queryByRole("treeitem", { name: "team" }),
    ).not.toBeInTheDocument();
  });

  // AC-003 — side-effect-contract
  it("should mark a collapsed folder aria-expanded false and an expanded one true", () => {
    renderTree({ expanded: ["folder-prod"] });
    expect(screen.getByRole("treeitem", { name: "prod" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("treeitem", { name: "staging" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  // TC-002, AC-003 — behavior
  it("should reveal children and flip aria-expanded when a collapsed folder is clicked", async () => {
    const user = userEvent.setup();
    renderTree({ expanded: [] });

    const prod = screen.getByRole("treeitem", { name: "prod" });
    expect(prod).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("treeitem", { name: "team" }),
    ).not.toBeInTheDocument();

    await user.click(prod);

    expect(screen.getByRole("treeitem", { name: "prod" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("treeitem", { name: "team" })).toBeInTheDocument();
  });

  // AC-003 — side-effect-contract
  it("should place a folder's children inside a group element", () => {
    renderTree({ expanded: ["folder-prod"] });
    const groups = screen.getAllByRole("group");
    const hasTeam = groups.some(
      (group) =>
        within(group).queryByRole("treeitem", { name: "team" }) !== null,
    );
    expect(hasTeam).toBe(true);
  });

  // AC-004 — side-effect-contract (database row is expandable, collapsed by default)
  it("should mark a database treeitem aria-expanded false when its tables are not shown", () => {
    renderTree({ expanded: expandedToAppDb });
    expect(screen.getByRole("treeitem", { name: "app_db" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  // AC-004 — side-effect-contract (database row exposes a chevron toggle control)
  it("should expose a chevron toggle button on a database row named for its tables", () => {
    renderTree({ expanded: expandedToAppDb });
    const dbRow = screen.getByRole("treeitem", { name: "app_db" });
    expect(
      within(dbRow).getByRole("button", { name: /toggle .*tables/i }),
    ).toBeInTheDocument();
  });

  // behavior (the chevron auto-connects an idle database, then reveals its live catalog leaves)
  it("should connect an idle database and reveal its live table leaves when the chevron is clicked", async () => {
    const user = userEvent.setup();
    mockConnect.mockResolvedValueOnce({
      tables: [
        { schema: null, name: "accounts" },
        { schema: null, name: "audit_log" },
      ],
      views: [],
    });
    renderTree({ expanded: ["folder-staging"] });

    const dbRow = screen.getByRole("treeitem", { name: "admin_db" });
    await user.click(
      within(dbRow).getByRole("button", { name: /toggle .*tables/i }),
    );

    expect(mockConnect).toHaveBeenCalledWith("db-admin", expect.anything());
    expect(
      await screen.findByRole("treeitem", { name: "accounts" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("treeitem", { name: "audit_log" }),
    ).toBeInTheDocument();
  });

  // behavior (while a connect is in flight, clicking the chevron again aborts it and collapses)
  it("should abort an in-flight connect and collapse when the chevron is clicked again", async () => {
    const user = userEvent.setup();
    // A connect that never resolves keeps the row in the "connecting" state.
    mockConnect.mockReturnValueOnce(new Promise(() => {}));
    renderTree({ expanded: ["folder-staging"] });

    const chevron = () =>
      within(screen.getByRole("treeitem", { name: "admin_db" })).getByRole(
        "button",
        { name: /toggle .*tables/i },
      );

    await user.click(chevron());
    // amber "connecting" dot is shown while the connect is pending
    expect(
      await screen.findByLabelText(/admin_db connecting/i),
    ).toBeInTheDocument();

    await user.click(chevron());
    expect(mockCancelConnect).toHaveBeenCalledWith("db-admin");
    await waitFor(() => {
      expect(
        screen.getByRole("treeitem", { name: "admin_db" }),
      ).toHaveAttribute("aria-expanded", "false");
    });
  });

  // behavior (collapsing an errored database just collapses - it must NOT retry the connect, so no
  // amber "connecting" dot flashes; the chevron only connects when EXPANDING)
  it("should collapse without reconnecting when an errored database's chevron is clicked", async () => {
    const user = userEvent.setup();
    mockConnect.mockRejectedValueOnce(new Error("nope"));
    renderTree({ expanded: ["folder-staging"] });

    const chevron = () =>
      within(screen.getByRole("treeitem", { name: "admin_db" })).getByRole(
        "button",
        { name: /toggle .*tables/i },
      );

    // expand -> connect fails -> red error dot, row stays expanded
    await user.click(chevron());
    expect(await screen.findByLabelText(/admin_db error/i)).toBeInTheDocument();
    expect(mockConnect).toHaveBeenCalledTimes(1);

    // collapse -> no second connect, no amber connecting dot, and the red error dot clears to idle
    await user.click(chevron());
    expect(screen.getByRole("treeitem", { name: "admin_db" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText(/admin_db connecting/i)).toBeNull();
    await waitFor(() => {
      expect(screen.queryByLabelText(/admin_db error/i)).toBeNull();
    });
  });

  // TC-002, AC-004, E-2 — behavior (chevron reveals tables; no card opens)
  it("should reveal a database's table leaves and open no tab when its chevron is clicked", async () => {
    const user = userEvent.setup();
    renderTree({
      expanded: ["folder-staging"],
      connected: ["db-admin"],
      children: <ContentHeader />,
    });

    const dbRow = screen.getByRole("treeitem", { name: "admin_db" });
    expect(dbRow).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("treeitem", { name: "accounts" }),
    ).not.toBeInTheDocument();

    await user.click(
      within(dbRow).getByRole("button", { name: /toggle .*tables/i }),
    );

    expect(
      screen.getByRole("treeitem", { name: "accounts" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("treeitem", { name: "audit_log" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("treeitem", { name: "admin_db" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    // chevron toggles tables only; it must not open a database tab.
    expect(
      screen.queryByRole("tab", { name: "admin_db" }),
    ).not.toBeInTheDocument();
  });

  // AC-004, E-2 — behavior (chevron is a toggle)
  it("should hide a database's table leaves when its chevron is clicked a second time", async () => {
    const user = userEvent.setup();
    renderTree({ expanded: ["folder-staging"], connected: ["db-admin"] });

    const chevron = () =>
      within(screen.getByRole("treeitem", { name: "admin_db" })).getByRole(
        "button",
        { name: /toggle .*tables/i },
      );

    await user.click(chevron());
    expect(
      screen.getByRole("treeitem", { name: "accounts" }),
    ).toBeInTheDocument();

    await user.click(chevron());
    expect(
      screen.queryByRole("treeitem", { name: "accounts" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("treeitem", { name: "admin_db" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    // an already-connected database just toggles - the chevron must not re-connect.
    expect(mockConnect).not.toHaveBeenCalled();
  });

  // behavior: right-click Disconnect on an expanded connected database COLLAPSES the row. A
  // disconnected database shows no table children, so leaving the chevron expanded (with nothing
  // under it) is misleading and re-expanding to reconnect would otherwise need a redundant collapse.
  it("should collapse a database when it is disconnected via the context menu", async () => {
    const user = userEvent.setup();
    renderTree({
      expanded: ["folder-staging", "db-admin"],
      connected: ["db-admin"],
      connections: [["db-admin", adminConfig]],
    });

    const dbRow = screen.getByRole("treeitem", { name: "admin_db" });
    expect(dbRow).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("treeitem", { name: "accounts" }),
    ).toBeInTheDocument();

    fireEvent.contextMenu(dbRow);
    await user.click(
      await screen.findByRole("menuitem", { name: /^disconnect$/i }),
    );

    expect(screen.getByRole("treeitem", { name: "admin_db" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(
      screen.queryByRole("treeitem", { name: "accounts" }),
    ).not.toBeInTheDocument();
  });

  // E-5 — behavior (connecting a database whose catalog is empty expands to a childless list)
  it("should expand a database with no tables without revealing any table leaf", async () => {
    const user = userEvent.setup();
    mockConnect.mockResolvedValueOnce({ tables: [], views: [] });
    renderTree();

    const dbRow = screen.getByRole("treeitem", { name: "scratch_db" });
    await user.click(
      within(dbRow).getByRole("button", { name: /toggle .*tables/i }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole("treeitem", { name: "scratch_db" }),
      ).toHaveAttribute("aria-expanded", "true");
    });
  });

  // AC-005, TC-003 — behavior (clicking the database name opens its card tab + selects it)
  it("should open a database tab and select the row when its name is clicked", async () => {
    const user = userEvent.setup();
    renderTree({ expanded: expandedToAppDb, children: <ContentHeader /> });

    const dbRow = screen.getByRole("treeitem", { name: "app_db" });
    expect(dbRow).toHaveAttribute("aria-selected", "false");

    await user.click(dbRow);

    expect(
      await screen.findByRole("tab", { name: "app_db" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("treeitem", { name: "app_db" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  // AC-006, TC-004 — behavior (clicking a table leaf opens a table tab + selects it)
  it("should open a table tab and select the leaf when a table is clicked", async () => {
    const user = userEvent.setup();
    renderTree({
      expanded: ["folder-staging"],
      connected: ["db-admin"],
      children: <ContentHeader />,
    });

    await user.click(
      within(screen.getByRole("treeitem", { name: "admin_db" })).getByRole(
        "button",
        { name: /toggle .*tables/i },
      ),
    );

    const tableLeaf = screen.getByRole("treeitem", { name: "accounts" });
    await user.click(tableLeaf);

    expect(
      await screen.findByRole("tab", { name: "accounts" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("treeitem", { name: "accounts" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  // AC-005 — side-effect-contract (selection tracks the active tab)
  it("should mark a database treeitem aria-selected true when it is the active tab", () => {
    renderTree({ expanded: ["folder-staging"], activeTabId: "db-admin" });
    expect(screen.getByRole("treeitem", { name: "admin_db" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByRole("treeitem", { name: "scratch_db" }),
    ).toHaveAttribute("aria-selected", "false");
  });

  // AC-005, E-2 — behavior (folder click does not change the active tab)
  it("should not change the active tab when a folder is clicked", async () => {
    const user = userEvent.setup();
    renderTree({ expanded: [], activeTabId: "db-scratch" });

    await user.click(screen.getByRole("treeitem", { name: "prod" }));

    expect(
      screen.getByRole("treeitem", { name: "scratch_db" }),
    ).toHaveAttribute("aria-selected", "true");
  });
});

describe("SidebarTree accent left bar (TC-005)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetInFlightConnects();
  });

  // The colored row's left bar is an inline inset box-shadow on the row element (it does not widen
  // the box, so the label never shifts); find the nearest element carrying one.
  function leftBarColor(treeitem: HTMLElement): string {
    let element: HTMLElement | null = treeitem;
    while (element) {
      if (element.style.boxShadow) {
        return element.style.boxShadow;
      }
      element = element.parentElement;
    }
    return "";
  }

  // AC-004, TC-005 - behavior (a colored database row carries an inline accent left bar)
  it("should render an accent left bar on a colored database row", () => {
    renderTree({ expanded: ["folder-staging"] });

    const adminRow = screen.getByRole("treeitem", { name: "admin_db" });
    expect(leftBarColor(adminRow)).not.toBe("");
  });

  // AC-004, TC-005, E-3 - behavior (an uncolored database row has no accent left bar)
  it("should not render an accent left bar on an uncolored database row", () => {
    renderTree({ expanded: ["folder-staging"] });

    const scratchRow = screen.getByRole("treeitem", { name: "scratch_db" });
    expect(leftBarColor(scratchRow)).toBe("");
  });
});

describe("SidebarTree connection status dot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetInFlightConnects();
  });

  function renderWithSettings(opts: {
    activeTabId: string;
    expanded: string[];
  }) {
    return render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialActiveTabId={opts.activeTabId}
        initialExpandedIds={opts.expanded}
      >
        <SidebarTree />
        <SettingsTab />
      </WorkspaceProvider>,
    );
  }

  // AC-006 — behavior (idle: no status dot)
  it("should show no status dot for a database that has not been connected", () => {
    renderWithSettings({
      activeTabId: "db-admin",
      expanded: ["folder-staging"],
    });
    expect(
      screen.queryByLabelText(/admin_db connected/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/admin_db error/i)).not.toBeInTheDocument();
  });

  // AC-006, TC-001 — behavior (green dot once a connect succeeds)
  it("should show a connected status dot on the database row after a successful connect", async () => {
    const user = userEvent.setup();
    mockConnect.mockResolvedValueOnce({
      tables: [
        { schema: null, name: "a" },
        { schema: null, name: "b" },
      ],
      views: [],
    });
    renderWithSettings({
      activeTabId: "db-admin",
      expanded: ["folder-staging"],
    });

    await user.click(screen.getByRole("button", { name: /^connect$/i }));

    expect(
      await screen.findByLabelText(/admin_db connected/i),
    ).toBeInTheDocument();
  });

  // AC-006, TC-002 — behavior (red dot once a connect fails)
  it("should show an error status dot on the database row after a failed connect", async () => {
    const user = userEvent.setup();
    mockConnect.mockRejectedValueOnce(new Error("nope"));
    renderWithSettings({
      activeTabId: "db-admin",
      expanded: ["folder-staging"],
    });

    await user.click(screen.getByRole("button", { name: /^connect$/i }));

    expect(await screen.findByLabelText(/admin_db error/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.queryByLabelText(/admin_db connected/i),
      ).not.toBeInTheDocument();
    });
  });
});

describe("SidebarTree Postgres schema labelling (flat)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetInFlightConnects();
  });

  function renderWithSettings(opts: {
    activeTabId: string;
    expanded: string[];
  }) {
    return render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialActiveTabId={opts.activeTabId}
        initialExpandedIds={opts.expanded}
      >
        <SidebarTree />
        <SettingsTab />
      </WorkspaceProvider>,
    );
  }

  // AC-004, TC-001 — behavior (a multi-schema Postgres catalog renders FLAT, schema-qualified table
  // leaves directly under the database - no intermediate schema row to expand)
  it("should render schema-qualified flat leaves when the catalog spans multiple schemas", async () => {
    // db-admin is restored expanded, so it auto-connects on mount (no manual Connect click).
    mockConnect.mockResolvedValueOnce({
      tables: [
        { schema: "public", name: "orders" },
        { schema: "analytics", name: "events" },
      ],
      views: [],
    });
    renderWithSettings({
      activeTabId: "db-admin",
      expanded: ["folder-staging", "db-admin"],
    });

    // no schema row, the qualified leaves appear directly
    expect(screen.queryByRole("treeitem", { name: "public" })).toBeNull();
    expect(
      await screen.findByRole("treeitem", { name: "public.orders" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("treeitem", { name: "analytics.events" }),
    ).toBeInTheDocument();
  });

  // AC-009, TC-002 — behavior (two schemas sharing a table name render two distinct qualified leaves)
  it("should render same-named tables in different schemas as distinct qualified leaves", async () => {
    mockConnect.mockResolvedValueOnce({
      tables: [
        { schema: "public", name: "users" },
        { schema: "analytics", name: "users" },
      ],
      views: [],
    });
    renderWithSettings({
      activeTabId: "db-admin",
      expanded: ["folder-staging", "db-admin"],
    });

    expect(
      await screen.findByRole("treeitem", { name: "public.users" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("treeitem", { name: "analytics.users" }),
    ).toBeInTheDocument();
  });

  // AC-004 — behavior (a single-schema Postgres catalog shows BARE table names, no qualifier)
  it("should render bare table names when the catalog has only one schema", async () => {
    mockConnect.mockResolvedValueOnce({
      tables: [
        { schema: "public", name: "users" },
        { schema: "public", name: "products" },
      ],
      views: [],
    });
    renderWithSettings({
      activeTabId: "db-admin",
      expanded: ["folder-staging", "db-admin"],
    });

    expect(
      await screen.findByRole("treeitem", { name: "users" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("treeitem", { name: "public.users" })).toBeNull();
  });

  // AC-005, TC-003 — behavior (a catalog with no schema renders bare table names)
  it("should render bare table names when the catalog carries no schema", async () => {
    mockConnect.mockResolvedValueOnce({
      tables: [
        { schema: null, name: "products" },
        { schema: null, name: "customers" },
      ],
      views: [],
    });
    renderWithSettings({
      activeTabId: "db-admin",
      expanded: ["folder-staging", "db-admin"],
    });

    expect(
      await screen.findByRole("treeitem", { name: "products" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("treeitem", { name: "customers" }),
    ).toBeInTheDocument();
  });
});

describe("SidebarTree startup expansion restore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetInFlightConnects();
  });

  // behavior: a database restored EXPANDED but idle on launch (its chevron points down) must
  // auto-connect and show its tables on mount - without a manual collapse+expand. Regression for
  // the "arrow down but no tables until double-click" bug: connect used to fire only from the
  // chevron toggle or the active database card, so a restored-expanded row that isn't the active
  // tab stayed empty. Here the active tab is a DIFFERENT node and no click happens.
  it("should auto-connect and list tables for a database restored expanded on launch", async () => {
    mockConnect.mockResolvedValueOnce({
      tables: [
        { schema: null, name: "accounts" },
        { schema: null, name: "audit_log" },
      ],
      views: [],
    });
    renderTree({
      expanded: ["folder-staging", "db-admin"],
      activeTabId: "scratch_db",
    });

    expect(
      await screen.findByRole("treeitem", { name: "accounts" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("treeitem", { name: "audit_log" }),
    ).toBeInTheDocument();
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  // behavior: a COLLAPSED database on launch must NOT auto-connect (no wasted connection to a
  // database the user hasn't opened).
  it("should not auto-connect a database that is collapsed on launch", async () => {
    renderTree({ expanded: ["folder-staging"], activeTabId: "scratch_db" });

    await waitFor(() => {
      expect(mockConnect).not.toHaveBeenCalled();
    });
  });
});
