import { useEffect, useState } from "react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Sidebar } from "@/components/workspace/sidebar";
import { Main } from "@/components/workspace/main";
import { CommandPalette } from "@/components/workspace/command-palette";

export function WorkspaceLayout() {
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "k" || !(event.metaKey || event.ctrlKey)) {
        return;
      }
      event.preventDefault();
      setIsPaletteOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <ResizablePanelGroup orientation="horizontal" className="h-full w-full">
      <ResizablePanel defaultSize="20%" minSize="12%" maxSize="40%">
        <Sidebar />
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize="80%">
        <Main />
      </ResizablePanel>
      <CommandPalette open={isPaletteOpen} onOpenChange={setIsPaletteOpen} />
    </ResizablePanelGroup>
  );
}
