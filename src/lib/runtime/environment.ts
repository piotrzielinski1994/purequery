import { isTauri } from "@tauri-apps/api/core";

// True only in the `npm run dev` browser build: Vite dev mode AND no Tauri host.
// - `npm run dev`   -> MODE "development", isTauri() false -> true
// - `npm start`     -> MODE "development", isTauri() true  -> false (native adapters)
// - vitest          -> MODE "test"                         -> false (empty-state default)
// - `npm run build` -> MODE "production"                   -> false (native adapters)
//
// Gated on MODE, not import.meta.env.DEV: Vitest also sets DEV=true, so a DEV
// gate would seed the demo workspace into the jsdom tests and break the
// empty-state assertions. MODE is "test" under Vitest.
export function isDevBrowser(): boolean {
  return import.meta.env.MODE === "development" && !isTauri();
}
