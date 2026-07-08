import { useEffect, useLayoutEffect, useRef } from "react";
import type { WindowController } from "@/lib/window/window-controller";

// Two-way sync between the native window's fullscreen state and the persisted
// setting: on launch restore a remembered fullscreen; while running, persist any
// fullscreen change so the next launch matches. Mount-once - the saved value is
// only read for the initial restore, runtime updates flow window -> settings.
export function useWindowFullscreenSync({
  controller,
  saved,
  onSave,
}: {
  controller: WindowController;
  saved: boolean;
  onSave: (fullscreen: boolean) => void;
}) {
  const savedRef = useRef(saved);
  const onSaveRef = useRef(onSave);
  // Keep the latest saved/onSave in refs without re-running the mount effect, so
  // the restore-once + subscribe wiring survives prop churn (e.g. a persist that
  // flips `saved`). Layout effect so the refs are current before any change fires.
  useLayoutEffect(() => {
    savedRef.current = saved;
    onSaveRef.current = onSave;
  });

  useEffect(() => {
    // Restore a remembered fullscreen; a saved-false never forces windowed mode
    // (don't fight a window the user/OS opened fullscreen).
    if (savedRef.current) {
      controller.setFullscreen(true);
    }
    const unsubscribePromise = controller.onFullscreenChange((fullscreen) => {
      if (fullscreen !== savedRef.current) {
        onSaveRef.current(fullscreen);
      }
    });
    return () => {
      unsubscribePromise.then((unsubscribe) => unsubscribe());
    };
  }, [controller]);
}
