/** Parser de líneas CSV con comillas (RFC 4180 básico). */
export function parseCsvLine(line: string): string[] {
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
    } else if (char === "," && !quoted) {
      out.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  out.push(current);
  return out;
}

/** Filas de un SpreadsheetML (.xls XML de Excel 2003). */
export function parseSpreadsheetRows(text: string): string[][] {
  const doc = new DOMParser().parseFromString(text, "text/xml");
  return [...doc.getElementsByTagName("Row")].map((row) =>
    [...row.getElementsByTagName("Cell")].map((cell) => cell.textContent?.trim() ?? "")
  );
}
