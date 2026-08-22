import { createVitestConfig } from "@pziel/pureui/vitest";

export default createVitestConfig({
  appUrl: import.meta.url,
  inlineDeps: ["codemirror-json-schema"],
  include: ["src/**/*.test.{ts,tsx}", "tests/**/*.{test,spec}.{ts,tsx}"],
});
