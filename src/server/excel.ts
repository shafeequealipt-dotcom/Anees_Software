import "server-only";
import ExcelJS from "exceljs";
import { Readable } from "node:stream";

export interface Column {
  header: string;
  key: string;
  width?: number;
  /** "money" cells are written as numbers with two decimals. */
  kind?: "text" | "money" | "number" | "date";
}

const MAX_ROWS = 5000;

export async function toXlsx(sheetName: string, columns: Column[], rows: Record<string, string | number | null | undefined>[], note?: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Billing";
  const ws = wb.addWorksheet(sheetName.slice(0, 31));
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? Math.max(12, c.header.length + 2) }));
  const head = ws.getRow(1);
  head.font = { bold: true };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF5" } };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  for (const r of rows) ws.addRow(r);
  columns.forEach((c, i) => {
    if (c.kind === "money") ws.getColumn(i + 1).numFmt = "#,##0.00";
    if (c.kind === "number") ws.getColumn(i + 1).numFmt = "#,##0.###";
  });
  if (note) {
    const n = wb.addWorksheet("Read me");
    n.getColumn(1).width = 110;
    note.split("\n").forEach((l) => n.addRow([l]));
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function xlsxResponse(buf: Buffer, fileName: string) {
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName.replace(/[^A-Za-z0-9._-]+/g, "-")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

/** Cell value as plain text, whatever Excel stored (number, date, formula, rich text, hyperlink). */
function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("result" in v && v.result !== undefined) return cellText(v.result as ExcelJS.CellValue);
    if ("richText" in v) return v.richText.map((t) => t.text).join("").trim();
    if ("text" in v) return String(v.text).trim();
  }
  return "";
}

/** "Sale Price (incl. tax)" → "saleprice(incl.tax)" so headings match however they were typed. */
export const normalizeHeader = (h: string) => h.toLowerCase().replace(/[\s_\-*]+/g, "");

export interface Table {
  rows: { line: number; cells: Record<string, string> }[];
}

/** Reads the first sheet of an .xlsx or .csv file. Row 1 is the heading row; empty rows are skipped. */
export async function readTable(buf: Buffer, fileName: string): Promise<Table> {
  const wb = new ExcelJS.Workbook();
  if (/\.csv$/i.test(fileName)) await wb.csv.read(Readable.from(buf));
  else await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("The file has no sheets.");
  const headers: string[] = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (c, col) => {
    headers[col] = normalizeHeader(cellText(c.value));
  });
  if (!headers.some(Boolean)) throw new Error("The first row must contain the column headings.");
  const rows: Table["rows"] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cells: Record<string, string> = {};
    let any = false;
    headers.forEach((h, col) => {
      if (!h) return;
      const t = cellText(row.getCell(col).value);
      if (t) any = true;
      cells[h] = t;
    });
    if (any) rows.push({ line: r, cells });
    if (rows.length > MAX_ROWS) throw new Error(`Import up to ${MAX_ROWS} rows at a time.`);
  }
  return { rows };
}

/** First non-empty value among several possible column headings. */
export function pick(cells: Record<string, string>, ...names: string[]): string {
  for (const n of names) {
    const v = cells[normalizeHeader(n)];
    if (v) return v;
  }
  return "";
}

export const yes = (v: string) => /^(y|yes|true|1|✓)$/i.test(v.trim());
export const isBlank = (v: string) => v.trim() === "";
