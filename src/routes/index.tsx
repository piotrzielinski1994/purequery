import { createNoopFolderPicker } from "@pziel/pureui";
import { createRoute } from "@tanstack/react-router";
import { isTauri } from "@tauri-apps/api/core";
import { useState } from "react";
import { WorkspaceLoader } from "@/components/workspace/workspace-loader";
import {
  createNoopLogStream,
  createTauriLogStream,
} from "@/lib/logging/log-stream";
import { isDevBrowser } from "@/lib/runtime/environment";
import { DEMO_WORKSPACE_PATH, demoFiles } from "@/lib/workspace/demo-seed";
import { createInMemoryWorkspaceFs } from "@/lib/workspace/in-memory-fs";
import { createTauriFolderPicker } from "@/lib/workspace/tauri-folder-picker";
import { createTauriWorkspaceFs } from "@/lib/workspace/tauri-fs";
import { rootRoute } from "@/routes/__root";

// Only the real Tauri host forwards backend log records to the webview; the dev-browser + jsdom
// get the noop (attachLogger would have no plugin to talk to).
function createLogStreamForEnv() {
  return isTauri() ? createTauriLogStream() : createNoopLogStream();
}

// The real Tauri host reads/writes the picked workspace folder via plugin-fs + plugin-dialog; the
// dev-browser gets an in-memory fs seeded with the demo workspace, jsdom an empty one (no webview
// to drive).
function createWorkspaceFsForEnv() {
  if (isTauri()) {
    return createTauriWorkspaceFs();
  }
  return isDevBrowser()
    ? createInMemoryWorkspaceFs({ [DEMO_WORKSPACE_PATH]: demoFiles() })
    : createInMemoryWorkspaceFs({});
}

function createFolderPickerForEnv() {
  return isTauri() ? createTauriFolderPicker() : createNoopFolderPicker();
}

export function HomePage() {
  const [logStream] = useState(createLogStreamForEnv);
  const [fs] = useState(createWorkspaceFsForEnv);
  const [picker] = useState(createFolderPickerForEnv);

  return <WorkspaceLoader fs={fs} picker={picker} logStream={logStream} />;
}

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
});
