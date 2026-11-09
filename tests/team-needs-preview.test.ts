import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TeamNeedsPreview } from "../src/features/TradeSearchControls";
import { starterFixture } from "./fixtures";
import { evaluate } from "../src/domain/valuation";

describe("TeamNeedsPreview: All Positional Grades", () => {
  it("renders positional grade tiles for all positions: QB, RB, WR, TE, FLEX, K, and D/ST", async () => {
    const dataset = await starterFixture();
    const model = evaluate(dataset, dataset.settings);
    const opponentTeam = String(dataset.tables.ModelTeams[1].TeamID);

    const html = renderToStaticMarkup(
      React.createElement(TeamNeedsPreview, {
        m: model,
        teams: [opponentTeam],
        scope: "Standard",
        initialTeam: opponentTeam,
      }),
    );

    // Verify container and grade tiles exist
    expect(html).toContain("trade-needs-preview");
    expect(html).toContain("trade-grade-tiles");

    // All 7 positions must be present in the grade tiles
    const expectedPositions = ["QB", "RB", "WR", "TE", "FLEX", "K", "D/ST"];
    for (const pos of expectedPositions) {
      expect(html).toContain(`<small>${pos}</small>`);
    }
  });

  it("marks the selected position tile as selected and aria-pressed when position is K", async () => {
    const dataset = await starterFixture();
    const model = evaluate(dataset, dataset.settings);
    const opponentTeam = String(dataset.tables.ModelTeams[1].TeamID);

    const html = renderToStaticMarkup(
      React.createElement(TeamNeedsPreview, {
        m: model,
        teams: [opponentTeam],
        scope: "Standard",
        initialTeam: opponentTeam,
        position: "K",
      }),
    );

    expect(html).toContain('<button type="button" class="trade-grade-tile is-selected" aria-pressed="true"><small>K</small>');
  });

  it("marks the selected position tile as selected and aria-pressed when position is FLEX", async () => {
    const dataset = await starterFixture();
    const model = evaluate(dataset, dataset.settings);
    const opponentTeam = String(dataset.tables.ModelTeams[1].TeamID);

    const html = renderToStaticMarkup(
      React.createElement(TeamNeedsPreview, {
        m: model,
        teams: [opponentTeam],
        scope: "Standard",
        initialTeam: opponentTeam,
        position: "FLEX",
      }),
    );

    expect(html).toContain('<button type="button" class="trade-grade-tile is-selected" aria-pressed="true"><small>FLEX</small>');
  });

  it("marks the selected position tile as selected and aria-pressed when position is D/ST", async () => {
    const dataset = await starterFixture();
    const model = evaluate(dataset, dataset.settings);
    const opponentTeam = String(dataset.tables.ModelTeams[1].TeamID);

    const html = renderToStaticMarkup(
      React.createElement(TeamNeedsPreview, {
        m: model,
        teams: [opponentTeam],
        scope: "Standard",
        initialTeam: opponentTeam,
        position: "D/ST",
      }),
    );

    expect(html).toContain('<button type="button" class="trade-grade-tile is-selected" aria-pressed="true"><small>D/ST</small>');
  });
});
