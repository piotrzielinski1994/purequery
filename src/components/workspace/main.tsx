import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Content } from "@/components/workspace/content";
import { Console } from "@/components/workspace/console";

export function Main() {
  return (
    <ResizablePanelGroup orientation="vertical" className="h-full">
      <ResizablePanel defaultSize="75%" minSize="30%">
        <Content />
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize="25%" minSize="10%">
        <Console />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
