import { expect, it } from "vitest";
import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";
import { importWorkbook, preflight, contentHash } from "../src/import/workbook";
import { workbook } from "./workbook-label-parity.test";

it("succeeds when an unused sheet exceeds 150 MiB uncompressed", async () => {
  const base = await workbook(true);
  const parts = unzipSync(base);

  // Create an unused sheet with ~160 MiB of repeating compressible XML.
  const chunk = '<row r="1"><c t="inlineStr"><is><t>' + "A".repeat(1000) + "</t></is></c></row>";
  // Using array of chunks to avoid single huge string concatenation issues
  const sheetXml = strToU8(
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
      chunk.repeat(160 * 100) + // 16 MB repeated or mock
      "</sheetData></worksheet>",
  );

  parts["xl/worksheets/sheet99.xml"] = sheetXml;
  // Declare it in xl/workbook.xml
  const wbXml = strFromU8(parts["xl/workbook.xml"]);
  parts["xl/workbook.xml"] = strToU8(
    wbXml.replace(
      "</sheets>",
      '<sheet name="UnusedHugeSheet" sheetId="99" r:id="rId99"/></sheets>',
    ),
  );
  // Declare it in xl/_rels/workbook.xml.rels
  const relsXml = strFromU8(parts["xl/_rels/workbook.xml.rels"]);
  parts["xl/_rels/workbook.xml.rels"] = strToU8(
    relsXml.replace(
      "</Relationships>",
      '<Relationship Id="rId99" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet99.xml"/></Relationships>',
    ),
  );

  const zipped = zipSync(parts);

  // Directly patch the central directory uncompressed size for sheet99 to 160 MiB
  // to ensure uncompressed size in zip header is exactly 160 MiB without needing 160 MiB in memory.
  const v = new DataView(zipped.buffer, zipped.byteOffset, zipped.byteLength);
  let end = -1;
  for (let i = zipped.length - 22; i >= Math.max(0, zipped.length - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  const count = v.getUint16(end + 10, true);
  let at = v.getUint32(end + 16, true);
  for (let i = 0; i < count; i++) {
    const nameLen = v.getUint16(at + 28, true);
    const extraLen = v.getUint16(at + 30, true);
    const commentLen = v.getUint16(at + 32, true);
    const name = strFromU8(zipped.subarray(at + 46, at + 46 + nameLen));
    if (name === "xl/worksheets/sheet99.xml") {
      v.setUint32(at + 24, 160 * 1024 * 1024, true); // 160 MiB
    }
    at += 46 + nameLen + extraLen + commentLen;
  }

  // The import must succeed because sheet99 is an unused sheet and should not be counted or unzipped.
  await expect(importWorkbook(zipped)).resolves.toHaveProperty("dataset");
}, 30000);

it("fails with 'Expanded workbook exceeds 500 MiB.' when a needed sheet exceeds 500 MiB", async () => {
  const base = await workbook(true);
  const v = new DataView(base.buffer, base.byteOffset, base.byteLength);
  let end = -1;
  for (let i = base.length - 22; i >= Math.max(0, base.length - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  const count = v.getUint16(end + 10, true);
  let at = v.getUint32(end + 16, true);
  for (let i = 0; i < count; i++) {
    const nameLen = v.getUint16(at + 28, true);
    const extraLen = v.getUint16(at + 30, true);
    const commentLen = v.getUint16(at + 32, true);
    const name = strFromU8(base.subarray(at + 46, at + 46 + nameLen));
    // Patch sheet1.xml (ESPN_Model_Data, a needed sheet) to 501 MiB
    if (name === "xl/worksheets/sheet1.xml") {
      v.setUint32(at + 24, 501 * 1024 * 1024, true);
    }
    at += 46 + nameLen + extraLen + commentLen;
  }

  await expect(importWorkbook(base)).rejects.toThrow("Expanded workbook exceeds 500 MiB.");
});

it("allows files up to 200 MiB and rejects files over 200 MiB", async () => {
  // Over 200 MiB
  const over200 = new Uint8Array(200 * 1024 * 1024 + 1);
  expect(() => preflight(over200)).toThrow("Workbook exceeds 200 MiB.");

  // 26 MiB file (between 25 and 200 MiB)
  const base = await workbook(true);
  const parts = unzipSync(base);
  // Store 26 MiB uncompressed so the .xlsx archive itself is > 26 MiB on disk
  parts["unused_large_binary.bin"] = [new Uint8Array(26 * 1024 * 1024), { level: 0 }] as any;
  const largeZip = zipSync(parts);
  expect(largeZip.length).toBeGreaterThan(25 * 1024 * 1024);
  expect(largeZip.length).toBeLessThan(200 * 1024 * 1024);

  // Must not throw "Workbook exceeds 25 MiB." or "Workbook exceeds 200 MiB."
  expect(() => preflight(largeZip)).not.toThrow("Workbook exceeds");
});

it("enforces table row limits: 200,000 for ModelHistory and 50,000 for other tables", async () => {
  const base = await workbook(true);
  const parts = unzipSync(base);

  // Find which table is ModelHistory and which is another table (e.g. ModelContext)
  let historyTablePath = "";
  let otherTablePath = "";
  let otherTableName = "";
  for (const key of Object.keys(parts)) {
    if (key.startsWith("xl/tables/table")) {
      const text = strFromU8(parts[key]);
      if (text.includes('displayName="ModelHistory"')) {
        historyTablePath = key;
      } else if (!otherTablePath) {
        otherTablePath = key;
        const match = text.match(/displayName="([^"]+)"/);
        otherTableName = match ? match[1] : "ModelContext";
      }
    }
  }

  // ModelHistory: 200,001 rows should fail
  const historyXml = strFromU8(parts[historyTablePath]);
  parts[historyTablePath] = strToU8(
    historyXml.replace(/ref="[^"]+"/, 'ref="A1:Z200002"'),
  );
  await expect(importWorkbook(zipSync(parts))).rejects.toThrow("Too many rows in ModelHistory.");

  // ModelHistory: 50,000 rows (greater than old 40,000 limit) should pass the row count check
  parts[historyTablePath] = strToU8(
    historyXml.replace(/ref="[^"]+"/, 'ref="A1:Z50001"'),
  );
  // It may fail on missing cell values, but MUST NOT fail with "Too many rows in ModelHistory."
  await expect(importWorkbook(zipSync(parts))).rejects.not.toThrow("Too many rows in ModelHistory.");

  // Other table: 50,001 rows should fail
  parts[historyTablePath] = strToU8(historyXml); // restore ModelHistory
  const otherXml = strFromU8(parts[otherTablePath]);
  parts[otherTablePath] = strToU8(
    otherXml.replace(/ref="[^"]+"/, 'ref="A1:Z50002"'),
  );
  await expect(importWorkbook(zipSync(parts))).rejects.toThrow(`Too many rows in ${otherTableName}.`);

  // Other table: 15,000 rows (greater than old 10,000 limit) should pass the row count check
  parts[otherTablePath] = strToU8(
    otherXml.replace(/ref="[^"]+"/, 'ref="A1:Z15001"'),
  );
  await expect(importWorkbook(zipSync(parts))).rejects.not.toThrow(`Too many rows in ${otherTableName}.`);
});

it("enforces 50 MiB extracted data limit in contentHash", async () => {
  const hugeTables: any = {
    ModelContext: [],
    ModelPlayers: [],
    ModelRoster: [],
    ModelOpponents: [],
    ModelDefense: [],
    ModelSchedule: [],
    ModelProjections: [],
    ModelHistory: Array.from({ length: 1000 }, () => ({
      data: "X".repeat(60000), // ~60 MB
    })),
  };
  await expect(contentHash(hugeTables, {} as any)).rejects.toThrow(
    "Extracted data exceeds 50 MiB.",
  );
});
