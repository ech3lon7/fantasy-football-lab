import * as XLSX from "xlsx";
import { unzipSync, zipSync, strFromU8 } from "fflate";
import { XMLParser } from "fast-xml-parser";
import profile from "../../docs/workbook-profile.json";
import {
  datasetSchema,
  settingsSchema,
  type Dataset,
  type Row,
  type Settings,
  tableNames,
  str,
  num,
  n,
  sd,
} from "../domain/contracts";
import { evaluate } from "../domain/valuation";
const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  processEntities: false,
});
const arr = <T>(x: T | T[] | undefined): T[] =>
  x === undefined ? [] : Array.isArray(x) ? x : [x];
export function preflight(bytes: Uint8Array) {
  if (bytes.length > 25 * 1024 * 1024) throw Error("Workbook exceeds 25 MiB.");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (v.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw Error("Not a supported XLSX ZIP package.");
  const count = v.getUint16(end + 10, true);
  let at = v.getUint32(end + 16, true),
    expanded = 0;
  if (count === 65535 || at === 0xffffffff)
    throw Error("ZIP64 workbooks are unsupported.");
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || v.getUint32(at, true) !== 0x02014b50)
      throw Error("Invalid workbook directory.");
    if (v.getUint16(at + 8, true) & 1)
      throw Error("Encrypted workbooks are unsupported.");
    expanded += v.getUint32(at + 24, true);
    if (expanded > 150 * 1024 * 1024)
      throw Error("Expanded workbook exceeds 150 MiB.");
    at +=
      46 +
      v.getUint16(at + 28, true) +
      v.getUint16(at + 30, true) +
      v.getUint16(at + 32, true);
  }
}
const normalizeDate = (x: unknown) =>
  typeof x === "number"
    ? new Date(Date.UTC(1899, 11, 30) + x * 86400000).toISOString()
    : typeof x === "string" && Number.isFinite(Date.parse(x))
      ? new Date(x).toISOString()
      : null;
const canonical = (x: unknown): unknown =>
  Array.isArray(x)
    ? x.map(canonical)
    : x && typeof x === "object"
      ? Object.fromEntries(
          Object.entries(x)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([k, v]) => [k, canonical(v)]),
        )
      : x;
export async function contentHash(
  tables: Dataset["tables"],
  settings: Settings,
) {
  const bytes = new TextEncoder().encode(
    JSON.stringify(canonical({ tables, settings })),
  );
  if (bytes.length > 10 * 1024 * 1024)
    throw Error("Extracted data exceeds 10 MiB.");
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  )
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
export async function fromTables(
  tables: Dataset["tables"],
  settings: Settings,
): Promise<Dataset> {
  const sourceUTC = normalizeDate(tables.ModelContext[0]?.RefreshUTC),
    normalized = {
      ...tables,
      ModelContext: tables.ModelContext.map((r) => ({
        ...r,
        RefreshUTC: sourceUTC,
      })),
    };
  for (const key of ["ModelPlayers", "ModelHistory"] as const)
    normalized[key] = tables[key].map((r) => ({
      ...r,
      SourceRefreshUTC: normalizeDate(r.SourceRefreshUTC),
    }));
  const d = datasetSchema.parse({
    schemaVersion: 1,
    adapterVersion: "v5.2",
    modelVersion: "v5.2-port-1",
    hash: "",
    importedAt: new Date().toISOString(),
    sourceUTC,
    tables: normalized,
    settings,
    issues: [],
  });
  validateSources(d);
  d.hash = await contentHash(d.tables, settings);
  return d;
}
export function validateSources(d: Dataset) {
  const t = d.tables,
    ctx = t.ModelContext[0];
  for (const key of ["Season", "CurrentWeek", "FinalWeek"])
    if (n(ctx?.[key]) === null || !Number.isInteger(ctx[key]))
      throw Error(`Invalid league context: ${key}.`);
  if (
    t.ModelContext.length !== 1 ||
    !t.ModelTeams.length ||
    !t.ModelPlayers.length
  )
    throw Error("Missing context, teams or players.");
  if (
    num(ctx.CurrentWeek) < 1 ||
    num(ctx.FinalWeek) > 17 ||
    num(ctx.FinalWeek) < 1 ||
    num(ctx.CurrentWeek) > 18
  )
    throw Error("Invalid fantasy scoring horizon.");
  if (num(ctx.TeamCount) !== t.ModelTeams.length)
    throw Error("Team count does not match the league context.");
  for (const key of [
    "QBSlots",
    "RBSlots",
    "WRSlots",
    "TESlots",
    "KSlots",
    "DSTSlots",
    "FlexSlots",
    "BenchSlots",
    "IRSlots",
    "QBLimit",
    "RBLimit",
    "WRLimit",
    "TELimit",
    "KLimit",
    "DSTLimit",
  ])
    if (
      n(ctx[key]) === null ||
      num(ctx[key]) < 0 ||
      !Number.isInteger(ctx[key])
    )
      throw Error(`Invalid roster rule: ${key}.`);
  const teamIds = new Set(t.ModelTeams.map((r) => str(r.TeamID))),
    ids = new Set<string>();
  for (const p of t.ModelPlayers) {
    const id = str(p.PlayerID);
    if (!Number.isSafeInteger(p.PlayerID) || ids.has(id))
      throw Error("Duplicate or invalid player ID.");
    ids.add(id);
    if (
      n(p.OnTeamID) === null ||
      (p.OnTeamID !== 0 && !teamIds.has(str(p.OnTeamID)))
    )
      throw Error("Missing or invalid player ownership.");
    if (!["QB", "RB", "WR", "TE", "K", "D/ST"].includes(str(p.Position)))
      throw Error("Unsupported player position.");
  }
  if (teamIds.size !== t.ModelTeams.length) throw Error("Duplicate team ID.");
  const rosterIds = new Set<string>();
  for (const r of t.ModelRosters) {
    if (
      !ids.has(str(r.PlayerID)) ||
      !teamIds.has(str(r.TeamID)) ||
      rosterIds.has(str(r.PlayerID))
    )
      throw Error("Invalid roster references.");
    rosterIds.add(str(r.PlayerID));
    if (
      t.ModelPlayers.find((p) => p.PlayerID === r.PlayerID)?.OnTeamID !==
      r.TeamID
    )
      throw Error("Roster and ownership disagree.");
  }
  const seen = new Map<string, Row>();
  for (const h of t.ModelHistory) {
    if (!ids.has(str(h.PlayerID)))
      throw Error("History references an unknown player.");
    const key = `${h.PlayerID}/${h.Season}/${h.Week}`,
      prior = seen.get(key);
    if (prior) {
      if (JSON.stringify(prior) !== JSON.stringify(h))
        throw Error("Conflicting duplicate history.");
      d.issues.push("Equivalent duplicate history coalesced.");
      continue;
    }
    seen.set(key, h);
  }
  d.tables.ModelHistory = [...seen.values()];
  const histories = new Map<string, Row[]>();
  for (const h of d.tables.ModelHistory)
    if (h.HistoryStatus === "Valid") {
      const key = str(h.PlayerID);
      if (
        n(h.Points) === null ||
        num(h.Games) <= 0 ||
        h.Season !== ctx.Season ||
        !Number.isInteger(h.Week) ||
        num(h.Week) < 1 ||
        num(h.Week) >= num(ctx.CurrentWeek)
      ) {
        const player = t.ModelPlayers.find((p) => str(p.PlayerID) === key);
        if (player)
          player.HistoryIssue =
            "Invalid completed-game history or participation";
        continue;
      }
      histories.set(key, [...(histories.get(key) ?? []), h]);
    }
  for (const p of t.ModelPlayers) {
    if (p.HistoryIssue) continue;
    const scores = (histories.get(str(p.PlayerID)) ?? []).sort(
      (a, b) => num(a.Week) - num(b.Week),
    );
    const count = num(p.GamesPlayed);
    if (scores.length !== count) {
      p.HistoryIssue = "History count differs from prepared aggregates";
      continue;
    }
    if (count) {
      const total = scores.reduce((a, r) => a + num(r.Points), 0),
        recent =
          scores.slice(-3).reduce((a, r) => a + num(r.Points), 0) /
          Math.min(3, count);
      if (
        n(p.ActualPoints) === null ||
        n(p.Actual_PPG) === null ||
        n(p.Last3_PPG) === null ||
        Math.abs(total - num(p.ActualPoints)) > 1e-7 ||
        Math.abs(total / count - num(p.Actual_PPG)) > 1e-7 ||
        Math.abs(recent - num(p.Last3_PPG)) > 1e-7
      )
        p.HistoryIssue = "History scores differ from prepared aggregates";
      if (
        count > 1 &&
        (n(p.ScoreSD) === null ||
          Math.abs(
            num(p.ScoreSD) - (sd(scores.map((r) => num(r.Points))) ?? 0),
          ) > 1e-7)
      )
        p.HistoryIssue = "Scoring variability differs from verified history";
    }
  }
  const scheduled = new Set<string>();
  for (const r of t.ModelSchedule) {
    const key = `${r.ProTeamID}/${r.Week}`;
    if (scheduled.has(key)) throw Error("Duplicate NFL schedule period.");
    scheduled.add(key);
  }
  if (!d.sourceUTC) d.issues.push("Source refresh timestamp unavailable.");
  if (d.sourceUTC && Date.parse(d.sourceUTC) > Date.now() + 300000)
    d.issues.push("Source refresh timestamp is in the future.");
}
export async function importWorkbook(bytes: Uint8Array) {
  preflight(bytes);
  const allowed = (name: string) =>
    /^xl\/(workbook\.xml|metadata\.xml|_rels\/workbook\.xml\.rels|styles\.xml|sharedStrings\.xml|worksheets\/(sheet\d+\.xml|_rels\/sheet\d+\.xml\.rels)|tables\/table\d+\.xml)$/.test(
      name,
    ) ||
    name === "[Content_Types].xml" ||
    name === "_rels/.rels";
  const parts = unzipSync(bytes, { filter: (f) => allowed(f.name) }),
    sheetParts = new Map<string, string>();
  const wbxml = xml.parse(strFromU8(parts["xl/workbook.xml"])),
    rels = xml.parse(strFromU8(parts["xl/_rels/workbook.xml.rels"]));
  for (const s of arr<any>(wbxml.workbook.sheets.sheet)) {
    const rel = arr<any>(rels.Relationships.Relationship).find(
      (r) => r["@_Id"] === s["@_r:id"],
    );
    if (rel) {
      const target = rel["@_Target"];
      sheetParts.set(
        s["@_name"],
        target.startsWith("/") ? target.slice(1) : `xl/${target}`,
      );
    }
  }
  const wb = XLSX.read(zipSync(parts), {
    type: "array",
    cellDates: false,
    cellFormula: false,
    bookVBA: false,
    sheets: [
      "ESPN_Model_Data",
      "Valuation_Detail",
      "Pillars_Valuation_Dashboard",
    ],
  });
  const main = sheetParts.get("ESPN_Model_Data");
  if (!main) throw Error("Unsupported workbook: ESPN_Model_Data is missing.");
  const filename = main.split("/").at(-1),
    relfile = `xl/worksheets/_rels/${filename}.rels`;
  if (!parts[relfile]) throw Error("Model table bindings are missing.");
  const tableRels = arr<any>(
    xml.parse(strFromU8(parts[relfile])).Relationships.Relationship,
  );
  const tables = {} as Dataset["tables"];
  for (const rel of tableRels) {
    if (!str(rel["@_Type"]).endsWith("/table")) continue;
    const path = str(rel["@_Target"]).startsWith("/")
      ? str(rel["@_Target"]).slice(1)
      : `xl/${str(rel["@_Target"]).replace(/^\.\.\//, "")}`;
    if (!parts[path]) continue;
    const tx = xml.parse(strFromU8(parts[path])).table,
      name = tx["@_displayName"] as (typeof tableNames)[number];
    if (!tableNames.includes(name)) continue;
    const headers = arr<any>(tx.tableColumns.tableColumn).map((c) =>
        str(c["@_name"]),
      ),
      wanted = profile.tables[name].headers;
    if (wanted.some((h) => !headers.includes(h)))
      throw Error(`Unsupported columns in ${name}.`);
    const range = XLSX.utils.decode_range(tx["@_ref"]);
    if (range.e.r - range.s.r > (name === "ModelHistory" ? 40000 : 10000))
      throw Error(`Too many rows in ${name}.`);
    const sheet = wb.Sheets.ESPN_Model_Data;
    tables[name] = [];
    for (let r = range.s.r + 1; r <= range.e.r; r++) {
      const row: Row = {};
      for (const header of wanted) {
        const c = range.s.c + headers.indexOf(header),
          value = sheet[XLSX.utils.encode_cell({ r, c })];
        if (value?.t === "e")
          throw Error(
            `Excel error in ${name}; recalculate and save the workbook.`,
          );
        row[header] = value?.v ?? null;
      }
      tables[name].push(row);
    }
  }
  for (const name of tableNames)
    if (!tables[name]) throw Error(`Required table ${name} is missing.`);
  const settingValues: Record<string, unknown> = {};
  for (const [key, loc] of Object.entries(profile.settings))
    settingValues[key] = wb.Sheets[loc.sheet]?.[loc.cell]?.v;
  const settings = settingsSchema.parse(settingValues),
    dataset = await fromTables(tables, settings),
    model = evaluate(dataset, settings);
  const detail = wb.Sheets.Valuation_Detail,
    parity: string[] = [];
  const metrics: Record<string, keyof (typeof model.players)[number]> = {
    ActualPPG: "actual",
    RecentPPG: "recent",
    ProjectedPPG: "projected",
    ExpectedPPG: "expected",
    ConsistencyPenalty: "penalty",
    ValuePPG: "value",
    BaselinePPG: "baseline",
    PlayerVORP: "vorp",
    PlayerIndices: "index",
    GemSignal: "gem",
    GemTrendDelta: "trendDelta",
  };
  if (detail) {
    const headers = new Map<string, number>();
    for (let c = 0; c < 228; c++) {
      const h = detail[XLSX.utils.encode_cell({ r: 21, c })]?.v;
      if (h) headers.set(str(h), c);
    }
    for (let i = 0; i < model.players.length; i++) {
      const pid = str(detail[XLSX.utils.encode_cell({ r: 22 + i, c: 0 })]?.v);
      const p = model.byId.get(pid);
      if (!p) continue;
      for (const [metric, key] of Object.entries(metrics)) {
        const c = headers.get(metric);
        if (c === undefined) continue;
        const cell = detail[XLSX.utils.encode_cell({ r: 22 + i, c })];
        if (!cell) continue;
        const expected = cell.v === "n.a." ? null : cell.v,
          actual = p[key];
        if (
          typeof expected === "number"
            ? typeof actual !== "number" || Math.abs(expected - actual) > 1e-8
            : actual !== expected
        )
          parity.push(`${p.name}: ${metric} differs from cached Excel output`);
      }
    }
  }
  if (parity.length)
    throw Error(
      `Calculation parity failed (${parity.length} differences). ${parity.slice(0, 3).join("; ")}`,
    );
  return {
    dataset,
    summary: `${model.players.length} players · ${dataset.tables.ModelTeams.length} teams · calculation checks passed`,
  };
}
