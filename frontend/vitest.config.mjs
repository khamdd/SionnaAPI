import { defineConfig } from "vitest/config";

// Test-only configuration. It does not affect `vite build` or dev server
// behavior. Tests run in the Node environment and stub browser globals
// (localStorage, fetch) explicitly instead of requiring a DOM emulation layer.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.{js,jsx}"],
  },
});
