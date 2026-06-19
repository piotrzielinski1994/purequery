import { createRoute } from "@tanstack/react-router";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
import {
  INITIAL_ACTIVE_QUERY_ID,
  INITIAL_EXPANDED_IDS,
} from "@/components/workspace/mock-data";
import { rootRoute } from "@/routes/__root";

function HomePage() {
  return (
    <WorkspaceProvider
      initialExpandedIds={INITIAL_EXPANDED_IDS}
      initialActiveQueryId={INITIAL_ACTIVE_QUERY_ID}
    >
      <WorkspaceLayout />
    </WorkspaceProvider>
  );
}

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
});
