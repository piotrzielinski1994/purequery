import { EditorView } from "@codemirror/view";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The editable JSON view of the loaded rows. It does not exist yet; the import fails until
// json-view.tsx ships, so each test fails on the missing component, not a typo.
import { JsonView } from "@/components/workspace/json-view";
import { rowsToJson } from "@/lib/workspace/json-edit";

const columns = ["_id", "name"];
const rows: (string | null)[][] = [
  ["1", "Alice"],
  ["2", null],
];

// CodeMirror does not lay out / render full text in jsdom, so reading the visible DOM is
// unreliable. The live EditorView's document is the source of truth (same technique as the
// SqlEditor tests), so assert the prettified rows landed in the editor state.
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

describe("JsonView", () => {
  // AC-005 - behavior: there is NO local Save/Discard (the Changes-tab/pending bar is the single
  // stage/commit gate); editing auto-stages instead.
  it("should not render local Save or Discard controls", () => {
    render(<JsonView columns={columns} rows={rows} onSave={() => {}} />);

    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /discard/i })).toBeNull();
  });

  // AC-005 - behavior: no status bar at rest - only the editor + (on error) an inline error line.
  it("should render no status bar when there is no error", () => {
    const { container } = render(
      <JsonView columns={columns} rows={rows} onSave={() => {}} />,
    );
    expect(container.querySelector(".border-t")).toBeNull();
  });

  // AC-005, TC-010 - behavior: the editor is seeded with the prettified JSON of the rows.
  it("should seed the editor with the prettified JSON of the rows", () => {
    const { container } = render(
      <JsonView columns={columns} rows={rows} onSave={() => {}} />,
    );

    expect(liveView(container).state.doc.toString()).toBe(
      rowsToJson(columns, rows),
    );
  });

  // AC-007 - behavior: editing the buffer auto-stages (debounced) the parsed rows via onSave.
  it("should auto-stage the parsed edited rows after an edit", async () => {
    const onSave = vi.fn();
    const { container } = render(
      <JsonView columns={columns} rows={rows} onSave={onSave} />,
    );
    const view = liveView(container);
    const edited = rowsToJson(columns, [
      ["1", "Alice"],
      ["2", "Bob"],
    ]);
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: edited },
    });

    // The auto-stage is debounced (real timer); allow generous slack so a slow/contended full-suite
    // run never races the default 1s waitFor timeout.
    await waitFor(() => expect(onSave).toHaveBeenCalled(), { timeout: 3000 });
    const lastCall = onSave.mock.calls.at(-1)?.[0];
    expect(lastCall).toEqual([
      { _id: "1", name: "Alice" },
      { _id: "2", name: "Bob" },
    ]);
  });

  // AC-007 - behavior: an invalid JSON buffer shows an inline error and does NOT auto-stage.
  it("should show an inline error and not stage when the buffer is invalid JSON", async () => {
    const onSave = vi.fn();
    const { container } = render(
      <JsonView columns={columns} rows={rows} onSave={onSave} />,
    );
    const view = liveView(container);
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: "{ not json" },
    });

    await waitFor(
      () => expect(screen.getByText(/invalid json/i)).toBeInTheDocument(),
      { timeout: 3000 },
    );
    expect(onSave).not.toHaveBeenCalled();
  });
});
