import { describe, expect, it } from "vitest";

import { filterWards, normalizeSearchText, parseWardCsv } from "./wardSearch";

const SAMPLE_CSV = [
  "ward_code,ward_name,ward_name_en,ward_full_name,ward_type,province_code,center_lat,center_lng,bbox_south,bbox_north,bbox_west,bbox_east,area_km2",
  "00166,Cầu Giấy,Cau Giay,Phường Cầu Giấy,Phường,01,21.030915,105.788062,21.017657,21.041853,105.778648,105.801292,3.74",
  "00160,Nghĩa Đô,Nghia Do,Phường Nghĩa Đô,Phường,01,21.045091,105.794402,21.03027,21.05679,105.780959,105.806643,4.34",
  "09877,An Khánh,An Khanh,Xã An Khánh,Xã,01,20.987788,105.707888,20.955372,21.011152,105.663925,105.742777,28.69",
].join("\n");

describe("normalizeSearchText", () => {
  it("strips Vietnamese diacritics and lowercases", () => {
    expect(normalizeSearchText("Phường Cầu Giấy")).toBe("phuong cau giay");
  });

  it("converts đ and Đ to d", () => {
    expect(normalizeSearchText("Đông Hòa")).toBe("dong hoa");
  });

  it("returns an empty string for nullish input", () => {
    expect(normalizeSearchText(null)).toBe("");
    expect(normalizeSearchText(undefined)).toBe("");
  });
});

describe("parseWardCsv", () => {
  it("parses rows and converts numeric fields to numbers", () => {
    const wards = parseWardCsv(SAMPLE_CSV);

    expect(wards).toHaveLength(3);
    expect(wards[0].ward_code).toBe("00166");
    expect(wards[0].ward_name).toBe("Cầu Giấy");
    expect(wards[0].bbox_south).toBeCloseTo(21.017657);
    expect(wards[0].area_km2).toBeCloseTo(3.74);
    expect(wards[0].ward_type).toBe("Phường");
  });

  it("handles a BOM prefix from utf-8-sig exports", () => {
    const wards = parseWardCsv(`\ufeff${SAMPLE_CSV}`);

    expect(wards).toHaveLength(3);
    expect(wards[0].ward_code).toBe("00166");
  });

  it("returns an empty array for empty input", () => {
    expect(parseWardCsv("")).toEqual([]);
  });
});

describe("filterWards", () => {
  const wards = parseWardCsv(SAMPLE_CSV);

  it("returns no matches for an empty query", () => {
    expect(filterWards(wards, "  ")).toEqual([]);
  });

  it("matches diacritic-insensitive prefixes first", () => {
    const matches = filterWards(wards, "cau giay");

    expect(matches).toHaveLength(1);
    expect(matches[0].ward_name).toBe("Cầu Giấy");
  });

  it("matches by english name", () => {
    const matches = filterWards(wards, "nghia");

    expect(matches).toHaveLength(1);
    expect(matches[0].ward_name).toBe("Nghĩa Đô");
  });

  it("falls back to substring matches", () => {
    const matches = filterWards(wards, "khanh");

    expect(matches).toHaveLength(1);
    expect(matches[0].ward_name).toBe("An Khánh");
  });

  it("limits the number of results", () => {
    expect(filterWards(wards, "a", 2)).toHaveLength(2);
  });
});
