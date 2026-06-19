import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ContentHeader } from "@/components/workspace/content-header";
import { StatementBar } from "@/components/workspace/statement-bar";
import { QueryPane } from "@/components/workspace/query-pane";
import { ResultsPane } from "@/components/workspace/results-pane";

export function Content() {
  return (
    <div className="flex h-full flex-col">
      <ContentHeader />
      <StatementBar />
      <ResizablePanelGroup orientation="horizontal" className="flex-1">
        <ResizablePanel defaultSize="50%" minSize="20%">
          <QueryPane />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize="50%" minSize="20%">
          <ResultsPane />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
