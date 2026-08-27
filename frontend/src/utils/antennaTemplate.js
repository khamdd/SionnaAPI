import { DEFAULT_ANTENNAS } from "../constants";

const XLSX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const ANTENNA_TEMPLATE_COLUMNS = [
  "antenna_id",
  "x_m",
  "y_m",
  "height_m",
  "azimuth_deg",
  "tilt_min_deg",
  "tilt_current_deg",
  "tilt_max_deg",
  "tx_power_min_dbm",
  "tx_power_current_dbm",
  "tx_power_max_dbm",
];

const ANTENNA_TEMPLATE_INSTRUCTIONS = [
  ["Field", "Rule"],
  ["antenna_id", "Required unique text value, for example A1. Use 1 to 10 antennas."],
  ["x_m, y_m", "Required scene-relative position in meters."],
  ["height_m", "Required antenna height in meters."],
  ["azimuth_deg", "Required number from 0 to 360."],
  ["tilt_current_deg", "Required number between tilt_min_deg and tilt_max_deg."],
  ["tx_power_current_dbm", "Required number between tx_power_min_dbm and tx_power_max_dbm."],
];

export function downloadAntennaTemplate(antennas = DEFAULT_ANTENNAS) {
  const workbook = buildAntennaTemplateWorkbook(antennas);
  const blob = new Blob([workbook], { type: XLSX_MIME_TYPE });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "antenna-template.xlsx";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildAntennaTemplateWorkbook(antennas) {
  return createZip([
    ["[Content_Types].xml", contentTypesXml()],
    ["_rels/.rels", rootRelationshipsXml()],
    ["xl/workbook.xml", workbookXml()],
    ["xl/_rels/workbook.xml.rels", workbookRelationshipsXml()],
    ["xl/styles.xml", stylesXml()],
    ["xl/worksheets/sheet1.xml", worksheetXml(
      "Antennas",
      [ANTENNA_TEMPLATE_COLUMNS, ...antennas.map(antennaToRow)],
      { columnWidth: 18 },
    )],
    ["xl/worksheets/sheet2.xml", worksheetXml(
      "Instructions",
      ANTENNA_TEMPLATE_INSTRUCTIONS,
      { columnWidths: [24, 70] },
    )],
  ]);
}

function antennaToRow(antenna) {
  const [x, y, height] = antenna.position;

  return [
    antenna.id,
    x,
    y,
    height,
    antenna.azimuth,
    antenna.tilt.min,
    antenna.tilt.current,
    antenna.tilt.max,
    antenna.tx_power.min,
    antenna.tx_power.current,
    antenna.tx_power.max,
  ];
}

function contentTypesXml() {
  return xmlDeclaration(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`);
}

function rootRelationshipsXml() {
  return xmlDeclaration(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`);
}

function workbookXml() {
  return xmlDeclaration(`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Antennas" sheetId="1" r:id="rId1"/>
    <sheet name="Instructions" sheetId="2" r:id="rId2"/>
  </sheets>
</workbook>`);
}

function workbookRelationshipsXml() {
  return xmlDeclaration(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);
}

function stylesXml() {
  return xmlDeclaration(`<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><name val="Calibri"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFDCEBFA"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="3">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
    <xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
  </cellXfs>
</styleSheet>`);
}

function worksheetXml(sheetName, rows, { columnWidth, columnWidths } = {}) {
  const columnCount = Math.max(...rows.map((items) => items.length));

  return xmlDeclaration(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:${cellReference(columnCount, rows.length)}"/>
  <sheetViews><sheetView workbookViewId="0"/></sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>
    ${worksheetColumns(columnCount, columnWidth, columnWidths)}
  </cols>
  <sheetData>
    ${rows.map((items, rowIndex) => worksheetRow(items, rowIndex + 1)).join("\n    ")}
  </sheetData>
  <pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
</worksheet>`, sheetName);
}

function worksheetColumns(columnCount, columnWidth = 14, columnWidths = []) {
  return Array.from({ length: columnCount }, (_, index) => {
    const width = columnWidths[index] || columnWidth;
    const columnNumber = index + 1;

    return `<col min="${columnNumber}" max="${columnNumber}" width="${width}" customWidth="1"/>`;
  }).join("\n    ");
}

function worksheetRow(items, rowNumber) {
  return `<row r="${rowNumber}">${items.map((item, columnIndex) => (
    worksheetCell(item, columnIndex + 1, rowNumber)
  )).join("")}</row>`;
}

function worksheetCell(value, columnNumber, rowNumber) {
  const reference = cellReference(columnNumber, rowNumber);

  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${reference}" s="2"><v>${value}</v></c>`;
  }

  const style = rowNumber === 1 ? ' s="1"' : "";
  return `<c r="${reference}" t="inlineStr"${style}><is><t>${escapeXml(value)}</t></is></c>`;
}

function cellReference(columnNumber, rowNumber) {
  let column = "";
  let value = columnNumber;

  while (value > 0) {
    const remainder = (value - 1) % 26;
    column = String.fromCharCode(65 + remainder) + column;
    value = Math.floor((value - 1) / 26);
  }

  return `${column}${rowNumber}`;
}

function xmlDeclaration(xml) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${xml}`;
}

function createZip(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const [path, content] of files) {
    const nameBytes = encoder.encode(path);
    const dataBytes = encoder.encode(content);
    const checksum = crc32(dataBytes);
    const localHeader = localFileHeader(nameBytes, dataBytes, checksum);

    localParts.push(localHeader, dataBytes);
    centralParts.push(centralDirectoryHeader(nameBytes, dataBytes, checksum, offset));
    offset += localHeader.length + dataBytes.length;
  }

  const centralDirectorySize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = endOfCentralDirectory(files.length, centralDirectorySize, offset);

  return concatUint8Arrays([...localParts, ...centralParts, end]);
}

function localFileHeader(nameBytes, dataBytes, checksum) {
  const header = new Uint8Array(30 + nameBytes.length);
  const view = new DataView(header.buffer);

  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, 0, true);
  view.setUint32(14, checksum, true);
  view.setUint32(18, dataBytes.length, true);
  view.setUint32(22, dataBytes.length, true);
  view.setUint16(26, nameBytes.length, true);
  view.setUint16(28, 0, true);
  header.set(nameBytes, 30);

  return header;
}

function centralDirectoryHeader(nameBytes, dataBytes, checksum, localOffset) {
  const header = new Uint8Array(46 + nameBytes.length);
  const view = new DataView(header.buffer);

  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, 0, true);
  view.setUint16(14, 0, true);
  view.setUint32(16, checksum, true);
  view.setUint32(20, dataBytes.length, true);
  view.setUint32(24, dataBytes.length, true);
  view.setUint16(28, nameBytes.length, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, localOffset, true);
  header.set(nameBytes, 46);

  return header;
}

function endOfCentralDirectory(fileCount, centralDirectorySize, centralDirectoryOffset) {
  const header = new Uint8Array(22);
  const view = new DataView(header.buffer);

  view.setUint32(0, 0x06054b50, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, fileCount, true);
  view.setUint16(10, fileCount, true);
  view.setUint32(12, centralDirectorySize, true);
  view.setUint32(16, centralDirectoryOffset, true);
  view.setUint16(20, 0, true);

  return header;
}

function concatUint8Arrays(parts) {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;

  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }

  return output;
}

function crc32(bytes) {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

const CRC32_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;

  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }

  return value >>> 0;
});

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
