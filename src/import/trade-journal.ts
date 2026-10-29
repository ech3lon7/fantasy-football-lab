import * as XLSX from "xlsx";
import { unzipSync } from "fflate";
import {
  journalImportSchema,
  type JournalEntry,
} from "../domain/trade-journal";

// Only normalized journal/player sheets are allowed; formulas, credentials and unrelated workbook text are never imported.
export function journalFromTables(
  offers: Record<string, unknown>[],
  lines: Record<string, unknown>[],
  recordedUTC = new Date().toISOString(),
  ownTeam?: string,
) {
  const entries: JournalEntry[] = offers.map((row) => {
    const offer = String(row.OfferID ?? ""),
      players = lines.filter((line) => String(line.OfferID) === offer);
    const ids = (side: string) =>
      players.filter((p) => p.Side === side).map((p) => String(p.PlayerID));
    const teamA = String(row.ProposerTeamID ?? ""),
      teamB = String(row.RecipientTeamID ?? "");
    if (
      !offer ||
      !teamA ||
      !teamB ||
      !ids("Offered").length ||
      !ids("Requested").length ||
      players.some((p) => !p.PlayerID)
    )
      throw Error(
        `Incomplete journal identifiers for ${offer || "an offer"}. No current ownership was invented.`,
      );
    return {
      id: `documented:${row.Season}:${offer}`,
      kind: "offer",
      payload: {
        negotiation: `documented:${row.Season}:${row.NegotiationID}`,
        ...(row.ParentOfferID
          ? { parent: `documented:${row.Season}:${row.ParentOfferID}` }
          : {}),
        season: String(row.Season),
        week: row.NFLWeek == null ? null : Number(row.NFLWeek),
        recordedUTC,
        date: "",
        draft: { teamA, teamB, give: ids("Offered"), get: ids("Requested") },
        names: Object.fromEntries(
          players.map((p) => [String(p.PlayerID), String(p.Player)]),
        ),
        teamNames: {
          [teamA]: String(row.Proposer),
          [teamB]: String(row.Recipient),
        },
        outcome: String(row.Outcome ?? "unknown").toLowerCase() as
          "accepted" | "rejected" | "unknown",
        responseActor: teamB,
        provenance: "documented",
        recipientIsUser: teamB === ownTeam,
        notes: [row.Notes, row.TimingBasis ? `Timing: ${row.TimingBasis}` : ""]
          .filter(Boolean)
          .join("\n"),
        responses: [],
      },
    };
  });
  return journalImportSchema.parse({ version: 1, entries });
}

// Bound compressed/expanded input before SheetJS parsing, and locate known headers without executing workbook formulas.
export async function importJournalWorkbook(
  bytes: Uint8Array,
  ownTeam?: string,
) {
  if (bytes.length > 25 * 1024 * 1024) throw Error("Workbook exceeds 25 MiB.");
  let expanded = 0;
  unzipSync(bytes, {
    filter: (file) => {
      expanded += file.originalSize;
      if (expanded > 150 * 1024 * 1024 || file.originalSize > 40 * 1024 * 1024)
        throw Error("Workbook expanded contents exceed the import limit.");
      return false;
    },
  });
  const wb = XLSX.read(bytes, {
    type: "array",
    cellFormula: false,
    cellHTML: false,
    cellStyles: false,
  });
  const rows = (sheet: string, first: string) => {
    const raw = wb.Sheets[sheet];
    if (!raw)
      throw Error(`This workbook has no supported ${sheet} journal sheet.`);
    const data = XLSX.utils.sheet_to_json<unknown[]>(raw, {
      header: 1,
      defval: null,
    });
    const start = data.slice(0, 30).findIndex((row) => row[0] === first);
    if (start < 0) throw Error(`Required ${sheet} headers are missing.`);
    const headers = data[start].map(String);
    return data
      .slice(start + 1)
      .filter((row) => row[0] != null && row[0] !== "")
      .map((row) =>
        Object.fromEntries(headers.map((name, i) => [name, row[i] ?? null])),
      );
  };
  const result = journalFromTables(
    rows("Trade_Journal", "OfferID"),
    rows("Trade_Players", "OfferID"),
    new Date().toISOString(),
    ownTeam,
  );
  // Archive only the supplement's explicit evidence columns; nothing from Power Query, connections or unrelated sheets is read.
  const allowed =
    "OfferID NFLWeek Side Player Position ActualPPG Last3PPG ESPNWeeklyProjection GamesBefore RecentGames OwnershipStatus GivingTeam SnapshotOwner NegotiationID Season CompletedThroughWeek PlayerID PointsBefore HistoryStatus ProjectionStatus HistoricalSeasonProjection SeasonProjectionStatus HistoricalInjuryStatus SourceRefreshUTC Team LineupSlot RosterTiming TeamID IsStarter RosterCount MarkedStarters BenchCount BestActualPPG BestPlayer SecondActualPPG SecondPlayer StarterWeeklyProjection IRCount PlayersWithPPG ContextStatus Source RequestedWeek ResponseWeek RequestedPlayers ReturnedRows Status".split(
      " ",
    );
  for (const sheet of [
    "Trade_Evidence",
    "Trade_Rosters",
    "Trade_Positions",
    "Trade_Status",
  ])
    if (wb.Sheets[sheet]) {
      const sourceRows = rows(
        sheet,
        sheet === "Trade_Status"
          ? "Source"
          : sheet === "Trade_Evidence"
            ? "OfferID"
            : "NFLWeek",
      );
      for (let i = 0; i < sourceRows.length; i += 100) {
        const chunk = sourceRows
          .slice(i, i + 100)
          .map((row) =>
            Object.fromEntries(
              Object.entries(row).filter(([key]) => allowed.includes(key)),
            ),
          );
        const digest = Array.from(
          new Uint8Array(
            await crypto.subtle.digest(
              "SHA-256",
              new TextEncoder().encode(JSON.stringify(chunk)),
            ),
          ),
        )
          .map((n) => n.toString(16).padStart(2, "0"))
          .join("");
        result.entries.push(
          journalImportSchema.shape.entries.element.parse({
            id: `context:${sheet}:${digest}`,
            kind: "context",
            payload: { source: sheet, rows: chunk },
          }),
        );
      }
    }
  return journalImportSchema.parse(result);
}
