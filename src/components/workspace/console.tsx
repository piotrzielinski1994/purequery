import { ScrollArea } from "@/components/ui/scroll-area";
import { useWorkspace } from "@/components/workspace/workspace-context";

export function Console() {
  const { consoleLines } = useWorkspace();

  return (
    <section
      aria-label="Console"
      className="flex h-full flex-col bg-muted/30 font-mono text-xs"
    >
      <div className="border-b px-3 py-1.5 tracking-wide text-muted-foreground uppercase">
        Console
      </div>
      <ScrollArea className="flex-1">
        <ul className="p-2">
          {consoleLines.map((line, index) => (
            <li key={index} className="py-0.5 text-muted-foreground">
              {line}
            </li>
          ))}
        </ul>
      </ScrollArea>
    </section>
  );
}
