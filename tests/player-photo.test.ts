import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlayerPhoto, playerInitials } from "../src/ui/PlayerPhoto";
import { teamColors } from "../src/domain/view/nfl-colors";

describe("playerInitials", () => {
  it("derives two-letter initials from full names", () => {
    expect(playerInitials("Justin Jefferson")).toBe("JJ");
    expect(playerInitials("Patrick Mahomes")).toBe("PM");
    expect(playerInitials("Amon-Ra St. Brown")).toBe("AB");
  });

  it("uses NFL team abbreviation for D/ST", () => {
    expect(playerInitials("49ers D/ST", "D/ST", "SF")).toBe("SF");
    expect(playerInitials("Ravens D/ST", "D/ST", "BAL")).toBe("BAL");
  });

  it("handles single-word names and empty strings gracefully", () => {
    expect(playerInitials("Single")).toBe("SI");
    expect(playerInitials("")).toBe("?");
  });
});

describe("PlayerPhoto component", () => {
  it("applies the player NFL team colour as background", () => {
    const p = { id: "4262921", name: "Justin Jefferson", pos: "WR", nfl: "MIN" };
    const markup = renderToStaticMarkup(h(PlayerPhoto, { player: p, size: 40 }));
    const expectedColor = teamColors("MIN").background;
    expect(markup).toContain(`background:${expectedColor}`);
    expect(markup).toContain("width:40px");
    expect(markup).toContain("height:40px");
  });

  it("renders lazy image for valid player with numeric ID", () => {
    const p = { id: "4262921", name: "Justin Jefferson", pos: "WR", nfl: "MIN" };
    const markup = renderToStaticMarkup(h(PlayerPhoto, { player: p, size: "md" }));
    expect(markup).toContain('loading="lazy"');
    expect(markup).toContain("https://a.espncdn.com/i/headshots/nfl/players/full/4262921.png");
  });

  it("renders initials fallback on team colour for D/ST", () => {
    const p = { id: "100", name: "Ravens D/ST", pos: "D/ST", nfl: "BAL" };
    const markup = renderToStaticMarkup(h(PlayerPhoto, { player: p }));
    expect(markup).not.toContain("https://a.espncdn.com");
    expect(markup).toContain("BAL");
    const balColor = teamColors("BAL").background;
    expect(markup).toContain(`background:${balColor}`);
  });

  it("resolves team aliases and falls back to neutral token", () => {
    expect(teamColors("WFT").background).toBe(teamColors("WSH").background);
    expect(teamColors("TEST").background).toBe(teamColors("BAL").background);
    expect(teamColors("MAIN").background).toBe(teamColors("DET").background);
    expect(teamColors("UNKNOWN").background).toBe("#4a5060");
  });
});
