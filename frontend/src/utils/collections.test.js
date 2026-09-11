import { describe, expect, it } from "vitest";

import { clone, removeMapValue, removeSetValue, toggleSetValue } from "./collections";

describe("clone", () => {
  it("returns a deep copy that is independent of the source", () => {
    const source = { solver: { size: [300, 300] }, tags: ["a", "b"] };
    const copy = clone(source);

    expect(copy).toEqual(source);
    expect(copy).not.toBe(source);
    copy.solver.size[0] = 999;
    copy.tags.push("c");

    expect(source.solver.size[0]).toBe(300);
    expect(source.tags).toEqual(["a", "b"]);
  });

  it("copies arrays, maps, sets, and null independently", () => {
    const map = new Map([["k", { v: 1 }]]);
    const set = new Set([1, 2]);

    const clonedMap = clone(map);
    const clonedSet = clone(set);

    expect(clonedMap).not.toBe(map);
    clonedMap.get("k").v = 2;
    expect(map.get("k").v).toBe(1);
    expect(clonedSet).not.toBe(set);

    expect(clone(null)).toBeNull();
    expect(clone(undefined)).toBeUndefined();
  });
});

describe("toggleSetValue", () => {
  it("adds a missing value and preserves existing members", () => {
    const current = new Set(["b"]);

    expect([...toggleSetValue(current, "a")].sort()).toEqual(["a", "b"]);
  });

  it("removes a present value", () => {
    const current = new Set(["a", "b"]);

    expect([...toggleSetValue(current, "a")]).toEqual(["b"]);
  });

  it("returns a new set and does not mutate the input", () => {
    const current = new Set(["a"]);

    const next = toggleSetValue(current, "a");

    expect(next).not.toBe(current);
    expect([...current]).toEqual(["a"]);
  });
});

describe("removeSetValue", () => {
  it("removes only the target value", () => {
    const next = removeSetValue(new Set(["a", "b"]), "a");

    expect([...next]).toEqual(["b"]);
  });

  it("returns a new set even when the value is absent", () => {
    const current = new Set(["a"]);

    const next = removeSetValue(current, "missing");

    expect(next).not.toBe(current);
    expect([...next]).toEqual(["a"]);
  });

  it("does not mutate the input", () => {
    const current = new Set(["a", "b"]);

    removeSetValue(current, "a");

    expect([...current]).toEqual(["a", "b"]);
  });
});

describe("removeMapValue", () => {
  it("returns the same reference when the key is absent", () => {
    const current = new Map([["a", 1]]);

    expect(removeMapValue(current, "missing")).toBe(current);
  });

  it("returns a new map without the key when present", () => {
    const current = new Map([["a", 1], ["b", 2]]);

    const next = removeMapValue(current, "a");

    expect(next).not.toBe(current);
    expect([...next]).toEqual([["b", 2]]);
    expect(current.get("a")).toBe(1);
  });
});
