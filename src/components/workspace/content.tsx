import { ContentHeader } from "@/components/workspace/content-header";
import { Workbench } from "@/components/workspace/workbench";

export function Content() {
  return (
    <div className="flex h-full flex-col">
      <ContentHeader />
      <div className="min-h-0 flex-1">
        <Workbench />
      </div>
    </div>
  );
}
