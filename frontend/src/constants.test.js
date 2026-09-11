import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { API_BASE_URL, ROUTES } from "./constants";
import * as storageKeys from "./constants/storage";

const FIXTURE_ROOT = fileURLToPath(
  new URL("../../test/fixtures/refactor", import.meta.url),
);

function readFixture(name) {
  return JSON.parse(readFileSync(`${FIXTURE_ROOT}/${name}`, "utf8"));
}

describe("route contract", () => {
  it("keeps the Phase 0 navbar route order and labels", () => {
    expect(ROUTES).toEqual(readFixture("frontend_contract.json").navbar_routes);
  });
});

describe("localStorage key contract", () => {
  it("keeps the Phase 0 storage key names", () => {
    const exportedKeys = Object.fromEntries(Object.entries(storageKeys));

    expect(exportedKeys).toEqual(readFixture("local_storage_contract.json").keys);
  });
});

describe("API base URL", () => {
  it("resolves to a string so request URLs stay constructible", () => {
    expect(typeof API_BASE_URL).toBe("string");
    expect(API_BASE_URL.length).toBeGreaterThan(0);
  });
});
