export function downloadText(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export type Cell = string | number;

export function downloadCsv(filename: string, rows: Cell[][]): void {
  const csv = rows
    .map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\r\n");
  downloadText(filename, "﻿" + csv, "text/csv;charset=utf-8");
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Excel (.xls en formato XML de Excel 2003): abre en Excel, LibreOffice y
 * Google Sheets, y la app lo vuelve a importar. Los números van como número;
 * los textos (incluidos códigos de barras) como texto para no perder ceros.
 */
export function downloadXls(filename: string, sheetName: string, rows: Cell[][]): void {
  const tableRows = rows
    .map(
      (row, index) =>
        `<Row>${row
          .map((cell) =>
            typeof cell === "number" && Number.isFinite(cell)
              ? `<Cell><Data ss:Type="Number">${cell}</Data></Cell>`
              : `<Cell${index === 0 ? ' ss:StyleID="h"' : ""}><Data ss:Type="String">${xmlEscape(String(cell ?? ""))}</Data></Cell>`
          )
          .join("")}</Row>`
    )
    .join("");
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?>` +
    `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">` +
    `<Styles><Style ss:ID="h"><Font ss:Bold="1"/></Style></Styles>` +
    `<Worksheet ss:Name="${xmlEscape(sheetName)}"><Table>${tableRows}</Table></Worksheet></Workbook>`;
  downloadText(filename, xml, "application/vnd.ms-excel;charset=utf-8");
}
