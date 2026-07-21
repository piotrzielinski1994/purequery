import { EditorView } from "@codemirror/view";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fixtureTree } from "@/components/workspace/__tests__/fixtures";
import { SqlTab } from "@/components/workspace/sql-tab";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";

function liveView(container: HTMLElement): EditorView {
  const editorEl = container.querySelector<HTMLElement>(".cm-editor");
  if (!editorEl) {
    throw new Error(".cm-editor not found");
  }
  const view = EditorView.findFromDOM(editorEl);
  if (!view) {
    throw new Error("live EditorView not found");
  }
  return view;
}

function renderSql(activeTabId?: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceProvider tree={fixtureTree} initialActiveTabId={activeTabId}>
        <SqlTab />
      </WorkspaceProvider>
    </QueryClientProvider>,
  );
}

describe("SqlTab", () => {
  // behavior (left: an editable CodeMirror SQL editor showing the active saved script - scripts are
  // document tabs and appDb's first script "active_users_script" is the active document)
  it("should render an editable SQL editor showing the active saved script", () => {
    const { container } = renderSql("db-app");
    const editor = screen.getByRole("textbox", { name: /sql editor/i });
    expect(editor).toHaveAttribute("contenteditable", "true");
    // CodeMirror renders the document across .cm-line divs (no textarea value), so
    // read the active script's text from the live EditorView's document instead of toHaveValue.
    expect(liveView(container).state.doc.toString()).toBe("SELECT 1");
  });

  // behavior (left header: a Run control)
  it("should render a Run button", () => {
    renderSql("db-app");
    expect(screen.getByRole("button", { name: /run/i })).toBeInTheDocument();
  });

  // behavior (Run is disabled and hints to connect when the database has no live connection)
  it("should disable Run and hint to connect when not connected", () => {
    renderSql("db-app");
    expect(screen.getByRole("button", { name: /run/i })).toBeDisabled();
    expect(screen.getByText(/connect first/i)).toBeInTheDocument();
  });

  // behavior (right: an idle results pane before any run)
  it("should show an idle results pane before a query is run", () => {
    renderSql("db-app");
    expect(screen.getByText(/ready/i)).toBeInTheDocument();
  });

  // behavior (a draggable divider separates the editor from the results)
  it("should render a resize separator between the editor and results", () => {
    renderSql("db-app");
    expect(
      screen.getByRole("separator", { name: /sql editor and results/i }),
    ).toBeInTheDocument();
  });
});
