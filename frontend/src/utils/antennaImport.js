import { ANTENNA_TEMPLATE_COLUMNS } from "./antennaTemplate";

const ANTENNA_SHEET_NAME = "Antennas";
const MAX_IMPORTED_ANTENNAS = 10;
const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;

export async function importAntennasFromWorkbook(file) {
  if (!file) {
    throw new Error("Choose an antenna workbook first.");
  }

  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    throw new Error("Import an .xlsx antenna template file.");
  }

  const entries = await unzipWorkbookEntries(await file.arrayBuffer());
  const workbook = parseXml(requiredEntry(entries, "xl/workbook.xml"));
  const relationships = parseWorkbookRelationships(requiredEntry(entries, "xl/_rels/workbook.xml.rels"));
  const sheetPath = findWorksheetPath(workbook, relationships, ANTENNA_SHEET_NAME);

  if (!sheetPath) {
    throw new Error(`Workbook must include an "${ANTENNA_SHEET_NAME}" sheet.`);
  }

  const sharedStrings = entries.has("xl/sharedStrings.xml")
    ? parseSharedStrings(entries.get("xl/sharedStrings.xml"))
    : [];
  const rows = parseWorksheetRows(requiredEntry(entries, sheetPath), sharedStrings);
  const antennas = validateAntennaRows(rows);

  return antennas;
}

function validateAntennaRows(rows) {
  const headerRow = rows.find((row) => row.some((value) => value !== ""));

  if (!headerRow) {
    throw new Error("Antennas sheet is empty.");
  }

  const headerIndexes = new Map(headerRow.map((value, index) => [normalizeHeader(value), index]));
  const missingColumns = ANTENNA_TEMPLATE_COLUMNS.filter((column) => !headerIndexes.has(column));

  if (missingColumns.length > 0) {
    throw new Error(`Missing required column(s): ${missingColumns.join(", ")}.`);
  }

  const dataRows = rows.slice(rows.indexOf(headerRow) + 1)
    .map((row, index) => ({ row, rowNumber: rows.indexOf(headerRow) + index + 2 }))
    .filter(({ row }) => row.some((value) => value !== ""));

  if (dataRows.length === 0) {
    throw new Error("Add at least one antenna row.");
  }

  if (dataRows.length > MAX_IMPORTED_ANTENNAS) {
    throw new Error(`Import up to ${MAX_IMPORTED_ANTENNAS} antennas.`);
  }

  const seenIds = new Set();
  const antennas = dataRows.map(({ row, rowNumber }) => {
    const value = (column) => row[headerIndexes.get(column)] ?? "";
    const id = String(value("antenna_id")).trim();

    if (!id) {
      throw new Error(`Row ${rowNumber}: antenna_id is required.`);
    }

    if (seenIds.has(id.toLowerCase())) {
      throw new Error(`Row ${rowNumber}: antenna_id "${id}" is duplicated.`);
    }

    seenIds.add(id.toLowerCase());

    const x = requiredNumber(value("x_m"), rowNumber, "x_m");
    const y = requiredNumber(value("y_m"), rowNumber, "y_m");
    const height = requiredNumber(value("height_m"), rowNumber, "height_m");
    const azimuth = requiredNumber(value("azimuth_deg"), rowNumber, "azimuth_deg");
    const tilt = {
      min: requiredNumber(value("tilt_min_deg"), rowNumber, "tilt_min_deg"),
      current: requiredNumber(value("tilt_current_deg"), rowNumber, "tilt_current_deg"),
      max: requiredNumber(value("tilt_max_deg"), rowNumber, "tilt_max_deg"),
    };
    const txPower = {
      min: requiredNumber(value("tx_power_min_dbm"), rowNumber, "tx_power_min_dbm"),
      current: requiredNumber(value("tx_power_current_dbm"), rowNumber, "tx_power_current_dbm"),
      max: requiredNumber(value("tx_power_max_dbm"), rowNumber, "tx_power_max_dbm"),
    };

    if (height <= 0) {
      throw new Error(`Row ${rowNumber}: height_m must be greater than 0.`);
    }

    if (azimuth < 0 || azimuth > 360) {
      throw new Error(`Row ${rowNumber}: azimuth_deg must be between 0 and 360.`);
    }

    validateRange(tilt, rowNumber, "tilt");
    validateRange(txPower, rowNumber, "tx_power");

    return {
      id,
      position: [x, y, height],
      azimuth,
      tilt,
      tx_power: txPower,
    };
  });

  return antennas;
}

function validateRange(range, rowNumber, label) {
  if (range.min > range.max) {
    throw new Error(`Row ${rowNumber}: ${label}_min must be less than or equal to ${label}_max.`);
  }

  if (range.current < range.min || range.current > range.max) {
    throw new Error(`Row ${rowNumber}: ${label}_current must be between ${label}_min and ${label}_max.`);
  }
}

function requiredNumber(value, rowNumber, column) {
  const parsed = typeof value === "number" ? value : Number(String(value).trim());

  if (!Number.isFinite(parsed)) {
    throw new Error(`Row ${rowNumber}: ${column} must be a number.`);
  }

  return parsed;
}

async function unzipWorkbookEntries(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);
  const endOffset = findEndOfCentralDirectory(view);
  const entryCount = view.getUint16(endOffset + 10, true);
  const centralDirectoryOffset = view.getUint32(endOffset + 16, true);
  const entries = new Map();
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(offset, true) !== ZIP_CENTRAL_DIRECTORY_HEADER) {
      throw new Error("Invalid .xlsx central directory.");
    }

    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const path = decodeBytes(bytes.slice(offset + 46, offset + 46 + fileNameLength));
    const data = await readZipEntry(bytes, view, localHeaderOffset, compressedSize, compressionMethod);

    entries.set(path.replace(/\\/g, "/"), decodeBytes(data));
    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

async function readZipEntry(bytes, view, localHeaderOffset, compressedSize, compressionMethod) {
  if (view.getUint32(localHeaderOffset, true) !== ZIP_LOCAL_FILE_HEADER) {
    throw new Error("Invalid .xlsx local file header.");
  }

  const fileNameLength = view.getUint16(localHeaderOffset + 26, true);
  const extraLength = view.getUint16(localHeaderOffset + 28, true);
  const dataStart = localHeaderOffset + 30 + fileNameLength + extraLength;
  const compressedData = bytes.slice(dataStart, dataStart + compressedSize);

  if (compressionMethod === 0) {
    return compressedData;
  }

  if (compressionMethod === 8) {
    return inflateRaw(compressedData);
  }

  throw new Error("Unsupported .xlsx compression method.");
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== "function") {
    throw new Error("This browser cannot read compressed .xlsx files.");
  }

  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function findEndOfCentralDirectory(view) {
  for (let offset = view.byteLength - 22; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === ZIP_END_OF_CENTRAL_DIRECTORY) {
      return offset;
    }
  }

  throw new Error("Invalid .xlsx file.");
}

function findWorksheetPath(workbook, relationships, sheetName) {
  const sheet = [...workbook.getElementsByTagName("sheet")]
    .find((item) => item.getAttribute("name") === sheetName);
  const relationshipId = sheet?.getAttribute("r:id");
  const target = relationships.get(relationshipId);

  if (!target) {
    return null;
  }

  return normalizeWorkbookTarget(target);
}

function parseWorkbookRelationships(xml) {
  const document = parseXml(xml);
  const relationships = new Map();

  for (const relationship of document.getElementsByTagName("Relationship")) {
    relationships.set(relationship.getAttribute("Id"), relationship.getAttribute("Target"));
  }

  return relationships;
}

function parseSharedStrings(xml) {
  const document = parseXml(xml);

  return [...document.getElementsByTagName("si")].map((item) => cellText(item));
}

function parseWorksheetRows(xml, sharedStrings) {
  const document = parseXml(xml);

  return [...document.getElementsByTagName("row")].map((row) => {
    const cells = [];

    for (const cell of row.getElementsByTagName("c")) {
      cells[columnIndexFromReference(cell.getAttribute("r"))] = parseCellValue(cell, sharedStrings);
    }

    return cells.map((value) => value ?? "");
  });
}

function parseCellValue(cell, sharedStrings) {
  const type = cell.getAttribute("t");

  if (type === "inlineStr") {
    return cellText(cell.getElementsByTagName("is")[0]);
  }

  const value = cell.getElementsByTagName("v")[0]?.textContent ?? "";

  if (type === "s") {
    return sharedStrings[Number(value)] ?? "";
  }

  if (type === "str") {
    return value;
  }

  return value === "" ? "" : Number(value);
}

function cellText(node) {
  if (!node) {
    return "";
  }

  return [...node.getElementsByTagName("t")]
    .map((item) => item.textContent || "")
    .join("");
}

function columnIndexFromReference(reference) {
  const letters = String(reference || "").match(/[A-Z]+/i)?.[0] || "A";

  return [...letters.toUpperCase()].reduce((sum, letter) => (
    sum * 26 + letter.charCodeAt(0) - 64
  ), 0) - 1;
}

function normalizeWorkbookTarget(target) {
  const normalized = target.replace(/\\/g, "/").replace(/^\/+/, "");
  return normalized.startsWith("xl/") ? normalized : `xl/${normalized}`;
}

function requiredEntry(entries, path) {
  const entry = entries.get(path);

  if (!entry) {
    throw new Error(`Invalid .xlsx file: ${path} is missing.`);
  }

  return entry;
}

function parseXml(xml) {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  const error = document.getElementsByTagName("parsererror")[0];

  if (error) {
    throw new Error("Invalid .xlsx XML content.");
  }

  return document;
}

function normalizeHeader(value) {
  return String(value).trim().toLowerCase();
}

function decodeBytes(bytes) {
  return new TextDecoder().decode(bytes);
}
