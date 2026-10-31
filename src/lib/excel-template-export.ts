import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

export type ReportExportKind = "PELANGGARAN" | "PROVOS" | "LAKA_LALIN" | "SIM_TNI";
export type ReportExportPayload = {
  kind: ReportExportKind;
  periodValue: string;
  pomdamCode: string;
  pomdamName: string;
  values: Record<string, string>;
};
export type ReportExportResult = {
  bytes: Uint8Array;
  fileName: string;
  notices: string[];
};

const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const POMDAM_ALIASES: Record<string, string[]> = {
  "XV/PTM": ["XV/PTM", "XVI/PTM"],
  "XXII/TB": ["XXII/TB", "XX/TB"],
  "XXIV/MT": ["XXIV/MT", "XIV/MT"],
};

const VIOLATION_CODES = [
  "B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "B9", "B10", "B11",
  "C1", "C2", "C3", "C4", "C5", "C6",
] as const;
const RANKS = ["PA", "BA", "TA", "PNS"] as const;
const VIOLATION_ROW: Record<string, number> = {
  B1: 8, B2: 9, B3: 10, B4: 11, B5: 12, B6: 13, B7: 14, B8: 15, B9: 16, B10: 17, B11: 18,
  C1: 21, C2: 22, C3: 23, C4: 24, C5: 25, C6: 26,
};
const VIOLATION_GROUP_STARTS = [
  "C", "H", "M", "R", "W", "AB", "AG", "AL", "AQ", "AV", "BA",
  "BF", "BK", "BP", "BU", "BZ", "CE", "CJ", "CO", "CT", "CY",
] as const;

type SheetContext = {
  path: string;
  document: Document;
  sharedStrings: string[];
  rows: Map<number, Element>;
};

function parseXml(bytes: Uint8Array, name: string): Document {
  const text = strFromU8(bytes);
  const document = new DOMParser().parseFromString(text, "application/xml");
  if (document.getElementsByTagName("parsererror").length) {
    throw new Error("Template Excel rusak pada bagian " + name + ".");
  }
  return document;
}

function xmlBytes(document: Document): Uint8Array {
  return strToU8(new XMLSerializer().serializeToString(document));
}

function localElements(parent: ParentNode, localName: string): Element[] {
  return Array.from(parent.childNodes).filter(
    (item): item is Element => item.nodeType === 1 && (item as Element).localName === localName,
  );
}

function child(parent: ParentNode, localName: string): Element | null {
  return localElements(parent, localName)[0] ?? null;
}

function allDescendants(parent: ParentNode, localName: string): Element[] {
  return Array.from((parent as Document | Element).getElementsByTagNameNS("*", localName));
}

function columnNumber(column: string): number {
  let result = 0;
  for (const char of column.toUpperCase()) result = result * 26 + char.charCodeAt(0) - 64;
  return result;
}

function columnLetters(number: number): string {
  let value = number;
  let result = "";
  while (value > 0) {
    const digit = (value - 1) % 26;
    result = String.fromCharCode(65 + digit) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function splitAddress(address: string): { column: string; row: number } {
  const match = address.match(/^\$?([A-Z]+)\$?(\d+)$/i);
  if (!match) throw new Error("Alamat sel Excel tidak valid: " + address);
  return { column: match[1].toUpperCase(), row: Number(match[2]) };
}

function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replace(/^\//, "").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function resolveWorksheetPath(target: string): string {
  return normalizePath(target.startsWith("/") ? target : "xl/" + target);
}

function getRows(document: Document): Map<number, Element> {
  const sheetData = child(document.documentElement, "sheetData");
  if (!sheetData) throw new Error("Template Excel tidak memiliki sheetData.");
  const map = new Map<number, Element>();
  for (const row of localElements(sheetData, "row")) {
    const number = Number(row.getAttribute("r"));
    if (number > 0) map.set(number, row);
  }
  return map;
}

function ensureRow(context: SheetContext, rowNumber: number): Element {
  let row = context.rows.get(rowNumber);
  if (row) return row;
  const sheetData = child(context.document.documentElement, "sheetData");
  if (!sheetData) throw new Error("Template Excel tidak memiliki sheetData.");
  row = context.document.createElementNS(MAIN_NS, "row");
  row.setAttribute("r", String(rowNumber));
  const after = Array.from(context.rows.entries()).find(([number]) => number > rowNumber);
  if (after) sheetData.insertBefore(row, after[1]);
  else sheetData.appendChild(row);
  context.rows.set(rowNumber, row);
  return row;
}

function findCell(context: SheetContext, address: string): Element | null {
  const { row, column } = splitAddress(address);
  const rowElement = context.rows.get(row);
  if (!rowElement) return null;
  return localElements(rowElement, "c").find((cell) => cell.getAttribute("r")?.toUpperCase() === column + row) ?? null;
}

function ensureCell(context: SheetContext, address: string): Element {
  const existing = findCell(context, address);
  if (existing) return existing;
  const { row, column } = splitAddress(address);
  const rowElement = ensureRow(context, row);
  const cell = context.document.createElementNS(MAIN_NS, "c");
  cell.setAttribute("r", column + row);
  const targetColumn = columnNumber(column);
  const after = localElements(rowElement, "c").find((item) => {
    const parsed = splitAddress(item.getAttribute("r") ?? "A1");
    return columnNumber(parsed.column) > targetColumn;
  });
  if (after) rowElement.insertBefore(cell, after);
  else rowElement.appendChild(cell);
  return cell;
}

function getCellText(context: SheetContext, address: string): string {
  const cell = findCell(context, address);
  if (!cell) return "";
  const type = cell.getAttribute("t");
  if (type === "inlineStr") return allDescendants(cell, "t").map((node) => node.textContent ?? "").join("");
  const value = child(cell, "v")?.textContent ?? "";
  if (type === "s") return context.sharedStrings[Number(value)] ?? "";
  return value;
}

function parseNonNegativeInteger(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) throw new Error("Nilai laporan harus bilangan bulat nol atau lebih.");
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed)) throw new Error("Nilai laporan melewati batas angka yang didukung.");
  return parsed;
}

function clearCell(context: SheetContext, address: string): void {
  const cell = findCell(context, address);
  if (!cell) return;
  for (const name of ["f", "v", "is"]) {
    for (const node of localElements(cell, name)) cell.removeChild(node);
  }
  cell.removeAttribute("t");
}

function setNumber(context: SheetContext, address: string, value: number | null): void {
  const cell = ensureCell(context, address);
  for (const name of ["f", "v", "is"]) for (const node of localElements(cell, name)) cell.removeChild(node);
  cell.removeAttribute("t");
  if (value === null) return;
  const node = context.document.createElementNS(MAIN_NS, "v");
  node.textContent = String(value);
  cell.appendChild(node);
}

function setText(context: SheetContext, address: string, value: string): void {
  const cell = ensureCell(context, address);
  for (const name of ["f", "v", "is"]) for (const node of localElements(cell, name)) cell.removeChild(node);
  cell.setAttribute("t", "inlineStr");
  const inline = context.document.createElementNS(MAIN_NS, "is");
  const text = context.document.createElementNS(MAIN_NS, "t");
  if (value.startsWith(" ") || value.endsWith(" ")) text.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve");
  text.textContent = value;
  inline.appendChild(text);
  cell.appendChild(inline);
}

function setFormula(context: SheetContext, address: string, formula: string): void {
  const cell = ensureCell(context, address);
  for (const name of ["f", "v", "is"]) for (const node of localElements(cell, name)) cell.removeChild(node);
  cell.removeAttribute("t");
  const formulaNode = context.document.createElementNS(MAIN_NS, "f");
  formulaNode.textContent = formula.replace(/^=/, "");
  cell.appendChild(formulaNode);
  const valueNode = context.document.createElementNS(MAIN_NS, "v");
  cell.appendChild(valueNode);
}

function formulaSum(cells: string[]): string {
  return "SUM(" + cells.join(",") + ")";
}

function clearNumericCell(context: SheetContext, cell: Element): void {
  const type = cell.getAttribute("t");
  const address = cell.getAttribute("r");
  if (!address) return;
  const formula = child(cell, "f");
  const value = child(cell, "v")?.textContent ?? "";
  const textValue = type === "s" ? context.sharedStrings[Number(value)] ?? ""
    : type === "inlineStr" ? getCellText(context, address)
      : type === "str" ? value : "";
  const isText = type === "s" || type === "str" || type === "inlineStr";
  const isError = type === "e" || /^#(REF|VALUE|DIV\/0|NAME|N\/A|NUM|NULL)!?$/i.test(value) || /^#(REF|VALUE|DIV\/0|NAME|N\/A|NUM|NULL)!?$/i.test(textValue);
  const isNumeric = !isText && (value === "" || /^[-+]?\d+(?:\.\d+)?(?:[Ee][-+]?\d+)?$/.test(value));
  const numericString = isText && /^\s*[-+]?\d+(?:\.\d+)?\s*$/.test(textValue);
  if (formula || isError || isNumeric || numericString) clearCell(context, address);
}

function clearDataRange(context: SheetContext, startColumn: string, endColumn: string, startRow: number, endRow: number): void {
  const first = columnNumber(startColumn);
  const last = columnNumber(endColumn);
  for (let row = startRow; row <= endRow; row++) {
    const rowElement = context.rows.get(row);
    if (!rowElement) continue;
    for (const cell of localElements(rowElement, "c")) {
      const address = cell.getAttribute("r");
      if (!address) continue;
      const parsed = splitAddress(address);
      const col = columnNumber(parsed.column);
      if (col >= first && col <= last) clearNumericCell(context, cell);
    }
  }
}

function normalizePomdamLabel(input: string): string {
  return input.trim().toUpperCase().replace(/^POMDAM\s*/, "").replace(/\s+/g, "").replace(/\\/g, "/");
}

export function matchesPomdamLabel(label: string, canonicalCode: string): boolean {
  const normalized = normalizePomdamLabel(label);
  const canonical = canonicalCode.toUpperCase().replace(/\s+/g, "");
  const aliases = POMDAM_ALIASES[canonical] ?? [canonical];
  return aliases.some((alias) => alias.replace(/\s+/g, "") === normalized);
}

export function parseReportMonth(periodValue: string): { year: number; month: number; name: string; shortName: string } {
  const match = periodValue.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  if (!match) throw new Error("Periode laporan tidak valid.");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const names = ["JANUARI", "FEBRUARI", "MARET", "APRIL", "MEI", "JUNI", "JULI", "AGUSTUS", "SEPTEMBER", "OKTOBER", "NOVEMBER", "DESEMBER"];
  const short = ["JAN", "FEB", "MAR", "APR", "MEI", "JUN", "JUL", "AGU", "SEP", "OKT", "NOV", "DES"];
  return { year, month, name: names[month - 1], shortName: short[month - 1] };
}

function readSharedStrings(files: Record<string, Uint8Array>): string[] {
  const data = files["xl/sharedStrings.xml"];
  if (!data) return [];
  const document = parseXml(data, "sharedStrings.xml");
  return localElements(document.documentElement, "si").map((si) =>
    allDescendants(si, "t").map((node) => node.textContent ?? "").join(""),
  );
}

function getWorkbookSheetPaths(files: Record<string, Uint8Array>): Array<{ name: string; state: string; path: string }> {
  const workbook = files["xl/workbook.xml"];
  const rels = files["xl/_rels/workbook.xml.rels"];
  if (!workbook || !rels) throw new Error("File bukan workbook Excel yang valid.");
  const workbookDoc = parseXml(workbook, "workbook.xml");
  const relDoc = parseXml(rels, "workbook.xml.rels");
  const relationships = new Map<string, string>();
  for (const item of localElements(relDoc.documentElement, "Relationship")) {
    relationships.set(item.getAttribute("Id") ?? "", item.getAttribute("Target") ?? "");
  }
  const sheets = child(workbookDoc.documentElement, "sheets");
  if (!sheets) throw new Error("Workbook tidak memiliki daftar worksheet.");
  return localElements(sheets, "sheet").map((sheet) => {
    const relationshipId = sheet.getAttributeNS(REL_NS, "id") ?? sheet.getAttribute("r:id") ?? "";
    const target = relationships.get(relationshipId);
    if (!target) throw new Error("Referensi worksheet tidak ditemukan.");
    return {
      name: sheet.getAttribute("name") ?? "",
      state: sheet.getAttribute("state") ?? "visible",
      path: resolveWorksheetPath(target),
    };
  });
}

function chooseReportSheet(sheets: Array<{ name: string; state: string; path: string }>): { name: string; state: string; path: string } {
  const reportSheets = sheets.filter((sheet) => sheet.state === "visible" && !/^cover$/i.test(sheet.name));
  if (reportSheets.length !== 1) {
    throw new Error("Template harus memiliki tepat satu worksheet laporan yang terlihat (selain COVER).");
  }
  return reportSheets[0];
}

function sanitizeNonReportSheets(context: SheetContext): void {
  for (const row of context.rows.values()) {
    for (const cell of localElements(row, "c")) clearNumericCell(context, cell);
  }
}

function removeChartCaches(files: Record<string, Uint8Array>): void {
  for (const path of Object.keys(files)) {
    if (!/^xl\/charts\/chart\d+\.xml$/i.test(path)) continue;
    const document = parseXml(files[path], path);
    for (const name of ["numCache", "strCache", "numLit", "strLit", "multiLvlStrCache"]) {
      for (const node of allDescendants(document, name)) node.parentNode?.removeChild(node);
    }
    files[path] = xmlBytes(document);
  }
}

function removeExternalLinks(files: Record<string, Uint8Array>): void {
  const workbookPath = "xl/workbook.xml";
  const relsPath = "xl/_rels/workbook.xml.rels";
  if (files[workbookPath]) {
    const doc = parseXml(files[workbookPath], workbookPath);
    const externalReferences = child(doc.documentElement, "externalReferences");
    if (externalReferences) externalReferences.parentNode?.removeChild(externalReferences);
    files[workbookPath] = xmlBytes(doc);
  }
  if (files[relsPath]) {
    const doc = parseXml(files[relsPath], relsPath);
    for (const relationship of localElements(doc.documentElement, "Relationship")) {
      const type = relationship.getAttribute("Type") ?? "";
      if (type.endsWith("/externalLink") || type.endsWith("/calcChain")) relationship.parentNode?.removeChild(relationship);
    }
    files[relsPath] = xmlBytes(doc);
  }
  if (files["[Content_Types].xml"]) {
    const doc = parseXml(files["[Content_Types].xml"], "[Content_Types].xml");
    for (const node of localElements(doc.documentElement, "Override")) {
      const part = node.getAttribute("PartName") ?? "";
      if (part.startsWith("/xl/externalLinks/") || part === "/xl/calcChain.xml") node.parentNode?.removeChild(node);
    }
    files["[Content_Types].xml"] = xmlBytes(doc);
  }
  for (const path of Object.keys(files)) {
    if (/^xl\/externalLinks\//.test(path) || /^xl\/calcChain\.xml$/.test(path)) delete files[path];
  }
}

function scrubUnusedSharedStrings(files: Record<string, Uint8Array>, contexts: Map<string, SheetContext>): void {
  const path = "xl/sharedStrings.xml";
  if (!files[path]) return;
  const used = new Set<number>();
  for (const context of contexts.values()) {
    for (const row of context.rows.values()) {
      for (const cell of localElements(row, "c")) {
        if (cell.getAttribute("t") !== "s") continue;
        const rawIndex = child(cell, "v")?.textContent ?? "";
        const index = Number(rawIndex);
        if (Number.isInteger(index) && index >= 0) used.add(index);
      }
    }
  }
  const doc = parseXml(files[path], path);
  const items = localElements(doc.documentElement, "si");
  for (let index = 0; index < items.length; index++) {
    if (used.has(index)) continue;
    const item = items[index];
    while (item.firstChild) item.removeChild(item.firstChild);
    item.appendChild(doc.createElementNS(MAIN_NS, "t"));
  }
  const count = [...contexts.values()].reduce(
    (sum, context) => sum + [...context.rows.values()].flatMap((row) => localElements(row, "c")).filter((cell) => cell.getAttribute("t") === "s").length,
    0,
  );
  doc.documentElement.setAttribute("count", String(count));
  doc.documentElement.setAttribute("uniqueCount", String(items.length));
  files[path] = xmlBytes(doc);
}

function forceRecalculation(files: Record<string, Uint8Array>): void {
  const path = "xl/workbook.xml";
  if (!files[path]) return;
  const doc = parseXml(files[path], path);
  let calc = child(doc.documentElement, "calcPr");
  if (!calc) {
    calc = doc.createElementNS(MAIN_NS, "calcPr");
    doc.documentElement.appendChild(calc);
  }
  calc.setAttribute("calcMode", "auto");
  calc.setAttribute("fullCalcOnLoad", "1");
  calc.setAttribute("forceFullCalc", "1");
  files[path] = xmlBytes(doc);
}

function writePeriodCell(context: SheetContext, address: string, month: { year: number; month: number; name: string; shortName: string }): void {
  setText(context, address, "PERIODE BULAN " + month.name + " " + month.year);
}

function requiredValue(values: Record<string, string>, key: string): number | null {
  return parseNonNegativeInteger(values[key]);
}

function findPomdamRow(context: SheetContext, column: string, start: number, end: number, code: string): number | null {
  for (let row = start; row <= end; row++) {
    if (matchesPomdamLabel(getCellText(context, column + row), code)) return row;
  }
  return null;
}

function exportViolation(context: SheetContext, payload: ReportExportPayload, month: ReturnType<typeof parseReportMonth>): string[] {
  const notices = ["File diisi untuk " + payload.pomdamName + " saja; kolom Pomdam lain dikosongkan."];
  clearDataRange(context, "C", "DH", 5, 28);
  clearDataRange(context, "C", "X", 49, 72);
  clearDataRange(context, "C", "W", 92, 93);
  clearDataRange(context, "C", "G", 151, 174);
  clearDataRange(context, "C", "G", 191, 191);

  let selectedStart: string | null = null;
  for (const start of VIOLATION_GROUP_STARTS) {
    if (matchesPomdamLabel(getCellText(context, start + "3"), payload.pomdamCode)) {
      selectedStart = start;
      break;
    }
  }
  if (!selectedStart) throw new Error("Pomdam " + payload.pomdamCode + " tidak ditemukan pada header template Pelanggaran.");

  const baseColumn = columnNumber(selectedStart);
  const groupTotalColumn = columnLetters(baseColumn + 4);
  for (const code of VIOLATION_CODES) {
    const row = VIOLATION_ROW[code];
    for (let i = 0; i < RANKS.length; i++) {
      setNumber(context, columnLetters(baseColumn + i) + row, requiredValue(payload.values, code + "_" + RANKS[i]));
    }
    setFormula(context, groupTotalColumn + row, formulaSum(RANKS.map((_, i) => columnLetters(baseColumn + i) + row)));
  }

  const subtotalRows: Array<{ target: number; sourceRows: number[] }> = [
    { target: 19, sourceRows: Array.from({ length: 11 }, (_, index) => index + 8) },
    { target: 27, sourceRows: Array.from({ length: 6 }, (_, index) => index + 21) },
    { target: 28, sourceRows: [...Array.from({ length: 11 }, (_, index) => index + 8), ...Array.from({ length: 6 }, (_, index) => index + 21)] },
  ];
  for (const { target, sourceRows } of subtotalRows) {
    for (let rankIndex = 0; rankIndex < 4; rankIndex++) {
      const column = columnLetters(baseColumn + rankIndex);
      setFormula(context, column + target, formulaSum(sourceRows.map((row) => column + row)));
    }
    setFormula(context, columnLetters(baseColumn + 4) + target, formulaSum(RANKS.map((_, i) => columnLetters(baseColumn + i) + target)));
  }

  const nationalTotalColumns = ["DD", "DE", "DF", "DG", "DH"];
  for (let rankIndex = 0; rankIndex < 4; rankIndex++) {
    const targetColumn = nationalTotalColumns[rankIndex];
    const detailRows = [...Array.from({ length: 11 }, (_, index) => index + 8), ...Array.from({ length: 6 }, (_, index) => index + 21)];
    for (const row of [...detailRows, 19, 27, 28]) {
      const sourceRowCells = VIOLATION_GROUP_STARTS.map((start) => columnLetters(columnNumber(start) + rankIndex) + row);
      setFormula(context, targetColumn + row, formulaSum(sourceRowCells));
    }
  }
  for (const row of [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 21, 22, 23, 24, 25, 26]) {
    const formulas = VIOLATION_GROUP_STARTS.map((start) => columnLetters(columnNumber(start) + 4) + row);
    setFormula(context, "DH" + row, formulaSum(formulas));
  }
  for (const row of [19, 27, 28]) {
    setFormula(context, "DH" + row, formulaSum(["DD", "DE", "DF", "DG"].map((col) => col + row)));
  }

  for (let col = 0; col < 21; col++) {
    const headerColumn = columnLetters(3 + col);
    const codeAtHeader = getCellText(context, headerColumn + "48");
    const headerCanonical = payload.pomdamCode;
    if (!matchesPomdamLabel(codeAtHeader, headerCanonical)) continue;
    for (const code of VIOLATION_CODES) {
      const row = code.startsWith("B") ? 52 + Number(code.slice(1)) - 1 : 65 + Number(code.slice(1)) - 1;
      const sourceRow = VIOLATION_ROW[code];
      setFormula(context, headerColumn + row, formulaSum(RANKS.map((_, i) => columnLetters(baseColumn + i) + sourceRow)));
    }
  }
  for (const row of [63, 71, 72]) {
    const sourceRows = row === 63
      ? Array.from({ length: 11 }, (_, index) => 52 + index)
      : row === 71
        ? Array.from({ length: 6 }, (_, index) => 65 + index)
        : [...Array.from({ length: 11 }, (_, index) => 52 + index), ...Array.from({ length: 6 }, (_, index) => 65 + index)];
    for (let col = 3; col <= 23; col++) {
      const letter = columnLetters(col);
      setFormula(context, letter + row, formulaSum(sourceRows.map((source) => letter + source)));
    }
  }
  for (const row of [...Array.from({ length: 11 }, (_, index) => 52 + index), ...Array.from({ length: 6 }, (_, index) => 65 + index), 63, 71, 72]) {
    setFormula(context, "X" + row, formulaSum(Array.from({ length: 21 }, (_, index) => columnLetters(3 + index) + row)));
  }
  for (let col = 3; col <= 23; col++) {
    const headerColumn = columnLetters(col);
    if (!matchesPomdamLabel(getCellText(context, headerColumn + "91"), payload.pomdamCode)) continue;
    setFormula(context, headerColumn + "92", formulaSum(VIOLATION_CODES.filter((code) => code.startsWith("B")).map((code) => groupTotalColumn + VIOLATION_ROW[code])));
    setFormula(context, headerColumn + "93", formulaSum(VIOLATION_CODES.filter((code) => code.startsWith("C")).map((code) => groupTotalColumn + VIOLATION_ROW[code])));
  }

  const finalRow = (code: string): number => code.startsWith("B") ? 153 + Number(code.slice(1)) : 166 + Number(code.slice(1));
  for (const code of VIOLATION_CODES) {
    const row = finalRow(code);
    for (let rankIndex = 0; rankIndex < 4; rankIndex++) {
      setNumber(context, columnLetters(3 + rankIndex) + row, requiredValue(payload.values, code + "_" + RANKS[rankIndex]));
    }
    setFormula(context, "G" + row, formulaSum(["C", "D", "E", "F"].map((col) => col + row)));
  }
  const finalSubtotalRows = [
    { row: 165, sourceRows: Array.from({ length: 11 }, (_, index) => 154 + index) },
    { row: 173, sourceRows: Array.from({ length: 6 }, (_, index) => 167 + index) },
    { row: 174, sourceRows: [...Array.from({ length: 11 }, (_, index) => 154 + index), ...Array.from({ length: 6 }, (_, index) => 167 + index)] },
  ];
  for (const subtotal of finalSubtotalRows) {
    for (const col of ["C", "D", "E", "F"]) setFormula(context, col + subtotal.row, formulaSum(subtotal.sourceRows.map((row) => col + row)));
    setFormula(context, "G" + subtotal.row, formulaSum(["C", "D", "E", "F"].map((col) => col + subtotal.row)));
  }
  for (const col of ["C", "D", "E", "F"]) {
    const rows = VIOLATION_CODES.map((item) => finalRow(item));
    setFormula(context, col + "191", formulaSum(rows.map((row) => col + row)));
  }
  setFormula(context, "G191", formulaSum(["C", "D", "E", "F"].map((col) => col + "191")));

  setText(context, "A1", "REKAP DATA BULAN " + month.name + " " + month.year);
  writePeriodCell(context, "A45", month);
  setText(context, "A147", "BIDANG PENEGAKAN HUKUM BULAN " + month.name + " " + month.year);
  setText(context, "BB1", "LAPORAN GAKKUM BULAN " + month.name + " " + month.year);
  return notices;
}

function exportProvos(context: SheetContext, payload: ReportExportPayload, month: ReturnType<typeof parseReportMonth>): string[] {
  const notices = ["File diisi untuk " + payload.pomdamName + " saja; baris Pomdam lain dikosongkan."];
  clearDataRange(context, "C", "K", 9, 30);
  const row = findPomdamRow(context, "B", 9, 29, payload.pomdamCode);
  if (!row) throw new Error("Pomdam " + payload.pomdamCode + " tidak ditemukan pada template Provos.");
  const columns: Array<[string, string]> = [
    ["C", "DSPP"], ["D", "NYATA"], ["E", "PA"], ["F", "BA"], ["G", "TA"], ["I", "SUDAH"], ["J", "BELUM"],
  ];
  for (const [column, key] of columns) setNumber(context, column + row, requiredValue(payload.values, key));
  setFormula(context, "H" + row, formulaSum(["E", "F", "G"].map((col) => col + row)));
  setFormula(context, "K" + row, formulaSum(["I", "J"].map((col) => col + row)));
  for (const col of ["C", "D", "E", "F", "G", "H", "I", "J", "K"]) {
    setFormula(context, col + "30", formulaSum(Array.from({ length: 21 }, (_, index) => col + (9 + index))));
  }
  writePeriodCell(context, "A5", month);
  return notices;
}

function exportLaka(context: SheetContext, payload: ReportExportPayload, month: ReturnType<typeof parseReportMonth>): string[] {
  const notices = ["File diisi untuk " + payload.pomdamName + " saja; baris Pomdam lain dikosongkan."];
  clearDataRange(context, "C", "Y", 10, 31);
  clearDataRange(context, "C", "F", 39, 60);
  clearDataRange(context, "C", "F", 66, 87);
  clearDataRange(context, "C", "F", 91, 112);
  clearDataRange(context, "C", "F", 117, 138);

  const mainRow = findPomdamRow(context, "B", 10, 30, payload.pomdamCode);
  if (!mainRow) throw new Error("Pomdam " + payload.pomdamCode + " tidak ditemukan pada template Laka Lalin.");
  const groups: Array<[string, string]> = [
    ["C", "ACC_GANDA"], ["D", "ACC_TUNGGAL"], ["E", "ACC_TABRAK_LARI"],
    ["G", "PERSONNEL_PA"], ["H", "PERSONNEL_BA"], ["I", "PERSONNEL_TA"], ["J", "PERSONNEL_PNS"],
    ["L", "VICTIM_RANK_PA"], ["M", "VICTIM_RANK_BA"], ["N", "VICTIM_RANK_TA"], ["O", "VICTIM_RANK_PNS"],
    ["Q", "VICTIM_OUTCOME_MD"], ["R", "VICTIM_OUTCOME_LB"], ["S", "VICTIM_OUTCOME_LR"],
    ["U", "MATERIAL_RANDIS_RB"], ["V", "MATERIAL_RANDIS_RR"], ["W", "MATERIAL_RAN_UMUM_RB"], ["X", "MATERIAL_RAN_UMUM_RR"],
  ];
  for (const [column, key] of groups) setNumber(context, column + mainRow, requiredValue(payload.values, key));
  for (const [sumCol, firstCol, lastCol] of [
    ["F", "C", "E"], ["K", "G", "J"], ["P", "L", "O"], ["T", "Q", "S"], ["Y", "U", "X"],
  ]) setFormula(context, sumCol + mainRow, formulaSum(Array.from({ length: columnNumber(lastCol) - columnNumber(firstCol) + 1 }, (_, index) => columnLetters(columnNumber(firstCol) + index) + mainRow)));

  for (const col of ["C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y"]) {
    setFormula(context, col + "31", formulaSum(Array.from({ length: 21 }, (_, index) => col + (10 + index))));
  }

  const secondaryBlocks = [
    { first: 39, last: 59, total: 60, sourceCols: ["C", "D", "E"], targetCols: ["C", "D", "E"], targetTotal: "F" },
    { first: 66, last: 86, total: 87, sourceCols: ["L", "M", "N", "O"], targetCols: ["C", "D", "E", "F"], targetTotal: null },
    { first: 91, last: 111, total: 112, sourceCols: ["Q", "R", "S"], targetCols: ["C", "D", "E"], targetTotal: "F" },
    { first: 117, last: 137, total: 138, sourceCols: ["U", "V", "W", "X"], targetCols: ["C", "D", "E", "F"], targetTotal: null },
  ];
  for (const block of secondaryBlocks) {
    for (let row = block.first; row <= block.last; row++) {
      if (!matchesPomdamLabel(getCellText(context, "B" + row), payload.pomdamCode)) continue;
      for (let i = 0; i < block.sourceCols.length; i++) {
        setFormula(context, block.targetCols[i] + row, block.sourceCols[i] + mainRow);
      }
      if (block.targetTotal) setFormula(context, block.targetTotal + row, formulaSum(block.targetCols.map((col) => col + row)));
    }
    for (let index = 0; index < block.targetCols.length; index++) {
      const col = block.targetCols[index];
      setFormula(context, col + block.total, formulaSum(Array.from({ length: block.last - block.first + 1 }, (_, offset) => col + (block.first + offset))));
    }
    if (block.targetTotal) setFormula(context, block.targetTotal + block.total, formulaSum(Array.from({ length: block.last - block.first + 1 }, (_, offset) => block.targetTotal + (block.first + offset))));
  }
  writePeriodCell(context, "A5", month);
  setText(context, "U3", "Penegakan Hukum Bulan " + month.name.toLowerCase().replace(/^./, (char) => char.toUpperCase()) + " " + month.year);
  return notices;
}

function exportSim(context: SheetContext, payload: ReportExportPayload, month: ReturnType<typeof parseReportMonth>): string[] {
  const notices = [
    "Matriks kiri diisi untuk " + payload.pomdamName + " saja; baris Pomdam lain dikosongkan.",
    "Matriks kanan Q:V berasal dari Lampiran G-H eksternal dan sengaja dibiarkan kosong; data tidak disalin dari Lampiran 6.",
  ];
  clearDataRange(context, "C", "H", 10, 31);
  clearDataRange(context, "K", "O", 10, 10);
  clearDataRange(context, "R", "V", 10, 30);
  const row = findPomdamRow(context, "B", 10, 30, payload.pomdamCode);
  if (!row) throw new Error("Pomdam " + payload.pomdamCode + " tidak ditemukan pada template SIM TNI.");
  const typeCodes = ["A", "BI", "BII", "BII_KHUSUS", "C"];
  const typeColumns = ["C", "D", "E", "F", "G"];
  for (let index = 0; index < typeCodes.length; index++) {
    setNumber(context, typeColumns[index] + row, requiredValue(payload.values, typeCodes[index]));
  }
  setFormula(context, "H" + row, formulaSum(typeColumns.map((col) => col + row)));
  for (const col of [...typeColumns, "H"]) setFormula(context, col + "31", formulaSum(Array.from({ length: 21 }, (_, index) => col + (10 + index))));
  for (let index = 0; index < typeColumns.length; index++) setFormula(context, columnLetters(11 + index) + "10", typeColumns[index] + "31");
  setText(context, "A1", month.shortName);
  setText(context, "H3", "Penegakan Hukum Periode Bulan " + month.name.toLowerCase().replace(/^./, (char) => char.toUpperCase()) + " " + month.year);
  writePeriodCell(context, "A6", month);
  return notices;
}

export async function exportReportFromTemplate(file: File, payload: ReportExportPayload): Promise<ReportExportResult> {
  if (!/\.xlsx$/i.test(file.name)) throw new Error("Pilih file template Excel .xlsx.");
  if (file.size > 20 * 1024 * 1024) throw new Error("Ukuran template maksimal 20 MB.");
  const month = parseReportMonth(payload.periodValue);
  const pomdamCode = payload.pomdamCode.trim().toUpperCase();
  if (!pomdamCode) throw new Error("Pomdam aktif tidak ditemukan.");
  const sourceBytes = new Uint8Array(await file.arrayBuffer());
  const files = unzipSync(sourceBytes) as Record<string, Uint8Array>;
  if (!files["xl/workbook.xml"]) throw new Error("File yang dipilih bukan workbook .xlsx yang valid.");
  const sharedStrings = readSharedStrings(files);
  const sheets = getWorkbookSheetPaths(files);
  const selected = chooseReportSheet(sheets);
  if (!files[selected.path]) throw new Error("Worksheet laporan tidak ditemukan di template.");

  const contexts = new Map<string, SheetContext>();
  for (const sheet of sheets) {
    if (!files[sheet.path]) continue;
    const document = parseXml(files[sheet.path], sheet.path);
    contexts.set(sheet.path, { path: sheet.path, document, sharedStrings, rows: getRows(document) });
  }
  const active = contexts.get(selected.path);
  if (!active) throw new Error("Worksheet laporan tidak dapat dibuka.");

  for (const [path, context] of contexts) {
    if (path !== selected.path) sanitizeNonReportSheets(context);
  }

  let notices: string[];
  switch (payload.kind) {
    case "PELANGGARAN": notices = exportViolation(active, payload, month); break;
    case "PROVOS": notices = exportProvos(active, payload, month); break;
    case "LAKA_LALIN": notices = exportLaka(active, payload, month); break;
    case "SIM_TNI": notices = exportSim(active, payload, month); break;
  }

  for (const [path, context] of contexts) files[path] = xmlBytes(context.document);
  scrubUnusedSharedStrings(files, contexts);
  removeChartCaches(files);
  removeExternalLinks(files);
  forceRecalculation(files);

  const output = zipSync(files, {
    level: 6,
    mem: 8,
  });
  const safeCode = pomdamCode.replace(/[^A-Z0-9-]+/g, "-");
  const fileName = "DATA-POMDAM-" + safeCode + "-" + payload.kind + "-" +
    month.year + "-" + String(month.month).padStart(2, "0") + ".xlsx";
  return { bytes: output, fileName, notices };
}
