import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { KIND_COLOR } from "@/components/workspace/kind-color";
import { useWorkspace } from "@/components/workspace/workspace-context";
import type { StatementKind } from "@/components/workspace/mock-data";

const KINDS: StatementKind[] = ["SELECT", "INSERT", "UPDATE", "DELETE", "DDL"];

const TARGET_TOKEN = /(\{\{[^}]+\}\})/g;

function TargetDisplay({ target }: { target: string }) {
  const parts = target.split(TARGET_TOKEN);
  return (
    <div
      role="textbox"
      aria-label="Target"
      aria-readonly="true"
      className="flex flex-1 items-center truncate px-3 font-mono text-xs"
    >
      {parts.map((part, index) =>
        part.startsWith("{{") ? (
          <span key={index} className="text-amber-500 dark:text-amber-400">
            {part}
          </span>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </div>
  );
}

export function StatementBar() {
  const { activeQuery } = useWorkspace();

  if (!activeQuery) {
    return (
      <div
        role="group"
        aria-label="Statement bar"
        className="flex h-10.25 items-center border-b bg-muted/30 px-3 text-sm text-muted-foreground"
      >
        No query selected
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-label="Statement bar"
      className="flex h-10.25 items-stretch border-b bg-muted/30"
    >
      <Select value={activeQuery.statementKind}>
        <SelectTrigger
          aria-label="Statement kind"
          className={cn(
            "h-full! w-fit rounded-none border-0 border-r border-r-border bg-transparent font-mono text-xs font-bold shadow-none focus-visible:ring-0 dark:bg-transparent",
            KIND_COLOR[activeQuery.statementKind],
          )}
        >
          {activeQuery.statementKind}
        </SelectTrigger>
        <SelectContent position="popper">
          {KINDS.map((kind) => (
            <SelectItem key={kind} value={kind}>
              {kind}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <TargetDisplay target={activeQuery.target} />
      <Button
        type="button"
        className="h-full rounded-none border-0 border-l border-l-border"
      >
        Run
      </Button>
    </div>
  );
}
