const WARD_CSV_NUMERIC_FIELDS = [
  "center_lat",
  "center_lng",
  "bbox_south",
  "bbox_north",
  "bbox_west",
  "bbox_east",
  "area_km2",
];

export function normalizeSearchText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();
}

export function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  const source = String(text ?? "").replace(/^\ufeff/, "");

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (inQuotes) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      field = "";
      if (row.some((value) => value !== "")) {
        rows.push(row);
      }
      row = [];
    } else {
      field += char;
    }
  }

  row.push(field.replace(/\r$/, ""));
  if (row.some((value) => value !== "")) {
    rows.push(row);
  }

  return rows;
}

export function parseWardCsv(text) {
  const rows = parseCsvRows(text);

  if (rows.length === 0) {
    return [];
  }

  const headers = rows[0];
  const numericHeaders = new Set(
    headers.filter((header) => WARD_CSV_NUMERIC_FIELDS.includes(header)),
  );

  return rows.slice(1).map((row) => {
    const ward = {};

    headers.forEach((header, index) => {
      const raw = row[index] ?? "";
      ward[header] = numericHeaders.has(header) ? Number(raw) : raw;
    });

    return ward;
  });
}

export function filterWards(wards, query, limit = 12) {
  const normalizedQuery = normalizeSearchText(query);

  if (!normalizedQuery) {
    return [];
  }

  const startsWithMatches = [];
  const includesMatches = [];

  for (const ward of wards) {
    const targets = [
      normalizeSearchText(ward.ward_name),
      normalizeSearchText(ward.ward_name_en),
      normalizeSearchText(ward.ward_full_name),
    ];

    if (targets.some((target) => target.startsWith(normalizedQuery))) {
      startsWithMatches.push(ward);
    } else if (targets.some((target) => target.includes(normalizedQuery))) {
      includesMatches.push(ward);
    }
  }

  const byName = (first, second) =>
    normalizeSearchText(first.ward_name).localeCompare(
      normalizeSearchText(second.ward_name),
    );

  return [...startsWithMatches.sort(byName), ...includesMatches.sort(byName)].slice(
    0,
    limit,
  );
}
