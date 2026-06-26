import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// One shared tab strip used by every tabbed surface (open content tabs, the database card's
// SQL/Views/Script/Settings, the console's History/Changes/Console). Centralising it kills the
// drift that came from three hand-rolled copies.
//
// The bar carries the single 1px bottom border. The active tab grows 1px past the bar
// (`-mb-px` + `h-[calc(100%+1px)]`) so its bottom edge lands ON that border, then a 1px inset
// `--primary` line paints over it - one underline, never a underline+border stack. The bar must
// NOT clip vertically (no `overflow-y`/`overflow-x-auto` on the bar), or the 1px overhang - and
// thus the underline - gets cut off.

export function TabBar({
  ariaLabel,
  children,
  trailing,
  className,
}: {
  ariaLabel: string;
  children: ReactNode;
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex h-9 shrink-0 items-stretch border-b bg-muted/30", className)}>
      <div role="tablist" aria-label={ariaLabel} className="flex h-full items-stretch">
        {children}
      </div>
      {trailing}
    </div>
  );
}

export function Tab({
  isActive,
  onSelect,
  ariaLabel,
  children,
  trailing,
  labelClassName,
}: {
  isActive: boolean;
  onSelect: () => void;
  ariaLabel?: string;
  children: ReactNode;
  trailing?: ReactNode;
  labelClassName?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-full items-center border-r hover:bg-accent",
        isActive
          ? "-mb-px h-[calc(100%+1px)] bg-accent shadow-[inset_0_-1px_0_0_var(--primary)]"
          : "bg-transparent",
      )}
    >
      {/* The label button fills the tab's full height + carries the horizontal padding, so the
          ENTIRE tab area (not just the glyph) is the click target. A trailing control (close X) sits
          after it with its own handler. */}
      <button
        type="button"
        role="tab"
        aria-selected={isActive}
        aria-label={ariaLabel}
        onClick={onSelect}
        className={cn(
          "flex h-full items-center gap-1.5 truncate px-3 text-sm",
          trailing ? "pr-1" : "",
          isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
          labelClassName,
        )}
      >
        {children}
      </button>
      {trailing ? <div className="pr-2">{trailing}</div> : null}
    </div>
  );
}
