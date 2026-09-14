import { requestJson } from "./http";

export function listProvinces() {
  return requestJson("/api/v1/vietnam/provinces");
}

export function searchWards(query, { provinceCode = "", limit = 12 } = {}) {
  const params = new URLSearchParams({
    q: query,
    limit: String(limit),
  });

  if (provinceCode) {
    params.set("province_code", provinceCode);
  }

  return requestJson(`/api/v1/vietnam/wards?${params.toString()}`);
}

export function getWardBoundary(wardCode) {
  return requestJson(
    `/api/v1/vietnam/wards/${encodeURIComponent(wardCode)}/boundary`,
  );
}
