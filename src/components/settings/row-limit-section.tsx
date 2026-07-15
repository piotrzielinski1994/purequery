import { useState } from "react";
import { useSettings } from "@/lib/settings/settings-context";

export function RowLimitSection() {
  const { settings, saveRowLimit } = useSettings();
  const [text, setText] = useState(() => String(settings.rowLimit));

  const commit = () => {
    const next = Number(text);
    if (Number.isInteger(next) && next > 0) {
      saveRowLimit(next);
      return;
    }
    setText(String(settings.rowLimit));
  };

  return (
    <section className="flex flex-col gap-1">
      <h2 className="text-lg font-medium">Row limit</h2>
      <p className="text-sm text-muted-foreground">
        Default number of rows a freshly opened table loads per page. Change the
        page size on an open table to override it there.
      </p>
      <label className="mt-2 flex w-fit items-center gap-2 text-sm">
        <span className="text-muted-foreground">Rows per page</span>
        <input
          type="number"
          min={1}
          aria-label="Row limit"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
          onBlur={commit}
          className="h-8 w-20 border border-border bg-transparent px-2 font-mono text-foreground outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
      </label>
    </section>
  );
}
