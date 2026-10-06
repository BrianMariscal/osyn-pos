/** Parser de líneas CSV con comillas (RFC 4180 básico). */
export function parseCsvLine(line: string, delimiter = ","): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i] as string;
    if (char === '"' && line[i + 1] === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      out.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  out.push(current);
  return out;
}

/**
 * Filas de un CSV completo. Detecta el separador (Excel en español guarda con
 * ";") y respeta saltos de línea dentro de celdas entre comillas.
 */
export function parseCsvRows(text: string): string[][] {
  const clean = text.replace(/^﻿/, "");
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const lines: string[] = [];
  let pending = "";
  for (const line of clean.split(/\r?\n/)) {
    pending = pending ? `${pending}\n${line}` : line;
    // Comillas sin cerrar: la celda continúa en la siguiente línea
    if ((pending.match(/"/g)?.length ?? 0) % 2 === 1) continue;
    lines.push(pending);
    pending = "";
  }
  if (pending) lines.push(pending);
  return lines.filter((line) => line.trim()).map((line) => parseCsvLine(line, delimiter));
}

/** Filas de un SpreadsheetML (.xls XML de Excel 2003). Respeta ss:Index (celdas vacías omitidas). */
export function parseSpreadsheetRows(text: string): string[][] {
  const doc = new DOMParser().parseFromString(text, "text/xml");
  const SS = "urn:schemas-microsoft-com:office:spreadsheet";
  const indexOf = (el: Element): number => Number(el.getAttributeNS(SS, "Index") || el.getAttribute("ss:Index") || 0);
  // Solo la primera hoja
  const sheet = doc.getElementsByTagName("Worksheet")[0] ?? doc;
  return [...sheet.getElementsByTagName("Row")].map((row) => {
    const cells: string[] = [];
    for (const cell of [...row.getElementsByTagName("Cell")]) {
      const index = indexOf(cell);
      while (index > 0 && cells.length < index - 1) cells.push("");
      cells.push(cell.textContent?.trim() ?? "");
    }
    return cells;
  });
}

/** Lee un archivo de Excel (.xls XML) o CSV como filas de texto. */
export async function readTableFile(file: File): Promise<string[][]> {
  const text = await file.text();
  if (/^\s*PK/.test(text)) {
    throw new Error("Archivo .xlsx no compatible: en Excel usa Guardar como › CSV o descarga la plantilla de la app.");
  }
  return text.trim().startsWith("<?xml") || text.includes("<Workbook") ? parseSpreadsheetRows(text) : parseCsvRows(text);
}
