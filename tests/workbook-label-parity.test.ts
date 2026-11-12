import { expect, it } from "vitest";
import * as XLSX from "xlsx";
import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";
import profile from "../docs/workbook-profile.json";
import { importWorkbook } from "../src/import/workbook";
import { evaluate, playerSignals } from "../src/domain/valuation";
import {
  gemVersion,
  preGemVersion,
  labelRuleVersion,
} from "../src/domain/label-rules";
import { tableNames } from "../src/domain/contracts";
import { fixture } from "./fixtures";

// Build a real, anonymous XLSX package with model-table bindings and cached label outputs for either contract.
async function workbook(current: boolean, tamper?: string, version?: string) {
  const d = await fixture();
  for (const row of d.tables.ModelHistory)
    Object.assign(row, {
      RushAttempts: 12,
      Targets: 8,
      Receptions: 3,
      RushTD: 0,
      ReceivingTD: 0,
    });
  const model = evaluate(d, d.settings, { workbookMode: !current });
  const book = XLSX.utils.book_new(),
    raw: XLSX.WorkSheet = {},
    detail: XLSX.WorkSheet = {},
    dashboard: XLSX.WorkSheet = {};
  const tableXml: string[] = [];
  for (const [i, name] of tableNames.entries()) {
    const headers = profile.tables[name].headers;
    const origin = { r: 0, c: i * 60 };
    XLSX.utils.sheet_add_aoa(
      raw,
      [
        headers,
        ...d.tables[name].map((row) => headers.map((h) => row[h] ?? null)),
      ],
      { origin },
    );
    const ref = XLSX.utils.encode_range(origin, {
      r: d.tables[name].length,
      c: origin.c + headers.length - 1,
    });
    tableXml.push(
      `<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="${i + 1}" name="${name}" displayName="${name}" ref="${ref}"><tableColumns count="${headers.length}">${headers.map((h, j) => `<tableColumn id="${j + 1}" name="${h}"/>`).join("")}</tableColumns></table>`,
    );
  }
  for (const [key, loc] of Object.entries(profile.settings))
    XLSX.utils.sheet_add_aoa(
      loc.sheet === "Valuation_Detail" ? detail : dashboard,
      [[d.settings[key as keyof typeof d.settings]]],
      { origin: loc.cell },
    );
  const columns = {
    GemSignal: "HO",
    AppSignals: "HU",
    ReducedWorkload: "HV",
    RoleGrowthWatch: "HW",
    ScoringBreakoutWatch: "HX",
    ProjectionGapWatch: "HY",
    TDCaution: "HZ",
    AppRegression: "IA",
  };
  for (const [header, column] of Object.entries(columns))
    if (current || header === "GemSignal")
      XLSX.utils.sheet_add_aoa(detail, [[header]], { origin: `${column}22` });
  if (current)
    XLSX.utils.sheet_add_aoa(
      detail,
      [[version ?? `${gemVersion}/${preGemVersion}/${labelRuleVersion}`]],
      { origin: "HV2" },
    );
  for (const [i, p] of model.players.entries()) {
    const row = i + 23,
      signals = playerSignals(p);
    XLSX.utils.sheet_add_aoa(detail, [[Number(p.id)]], { origin: `A${row}` });
    const values = {
      GemSignal: p.gem,
      AppSignals: signals.join("; "),
      ReducedWorkload: Number(signals.includes("Reduced workload")),
      RoleGrowthWatch: Number(signals.includes("Role-growth watch")),
      ScoringBreakoutWatch: Number(signals.includes("Scoring breakout watch")),
      ProjectionGapWatch: Number(signals.includes("Projection-gap watch")),
      TDCaution: Number(signals.includes("TD caution")),
      AppRegression: p.regression,
    };
    for (const [key, column] of Object.entries(columns))
      if (current || key === "GemSignal")
        XLSX.utils.sheet_add_aoa(
          detail,
          [[values[key as keyof typeof values]]],
          { origin: `${column}${row}` },
        );
  }
  if (tamper)
    XLSX.utils.sheet_add_aoa(detail, [[tamper === "GemSignal" ? "Watch" : 1]], {
      origin: `${columns[tamper as keyof typeof columns]}23`,
    });
  XLSX.utils.book_append_sheet(book, raw, "ESPN_Model_Data");
  XLSX.utils.book_append_sheet(book, detail, "Valuation_Detail");
  XLSX.utils.book_append_sheet(book, dashboard, "Pillars_Valuation_Dashboard");
  const parts = unzipSync(
    new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" })),
  );
  parts["xl/worksheets/_rels/sheet1.xml.rels"] = strToU8(
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${tableXml.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/table${i + 1}.xml"/>`).join("")}</Relationships>`,
  );
  tableXml.forEach((xml, i) => {
    parts[`xl/tables/table${i + 1}.xml`] = strToU8(xml);
  });
  // Declare every table part so the fixture exercises the same archive contract as an Excel-saved workbook.
  parts["[Content_Types].xml"] = strToU8(
    strFromU8(parts["[Content_Types].xml"]).replace(
      "</Types>",
      tableXml
        .map(
          (_, i) =>
            `<Override PartName="/xl/tables/table${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/>`,
        )
        .join("") + "</Types>",
    ),
  );
  return zipSync(parts);
}

// Older workbooks remain accepted, while a declared current policy validates primary and independent signals.
it("imports both legacy and current-policy cached labels", async () => {
  await expect(importWorkbook(await workbook(false))).resolves.toHaveProperty(
    "dataset",
  );
  await expect(importWorkbook(await workbook(true))).resolves.toHaveProperty(
    "dataset",
  );
});

// A current marker must never disable validation or silently accept corrupted signal outputs.
it("rejects mismatched labels, independent flags and unknown policy versions", async () => {
  await expect(
    importWorkbook(await workbook(true, "GemSignal")),
  ).rejects.toThrow("Calculation parity failed");
  await expect(
    importWorkbook(await workbook(true, "ReducedWorkload")),
  ).rejects.toThrow("Calculation parity failed");
  await expect(
    importWorkbook(await workbook(true, undefined, "future-policy")),
  ).rejects.toThrow("Unsupported workbook label policy");
});
