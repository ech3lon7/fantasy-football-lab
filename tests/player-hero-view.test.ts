import { describe, expect, it } from "vitest";
import {
  formBar,
  positionName,
  splitName,
  tierBadge,
} from "../src/domain/view/player-hero";

describe("hero form bar", () => {
  it("is Hot more than 1 point above Expected PPG, Cold more than 1 below, Steady otherwise", () => {
    expect(formBar(14.1, 12.3).label).toBe("Hot");
    expect(formBar(10.9, 12.3).label).toBe("Cold");
    expect(formBar(13.3, 12.3).label).toBe("Steady");
    expect(formBar(11.3, 12.3).label).toBe("Steady");
  });

  it("width is 50% + difference over EPPG times 120%, clamped to 6–100%", () => {
    expect(formBar(12.3, 12.3).widthPct).toBeCloseTo(50, 6);
    expect(formBar(14.1, 12.3).widthPct).toBeCloseTo(
      50 + (1.8 / 12.3) * 120,
      6,
    );
    expect(formBar(40, 12.3).widthPct).toBe(100);
    expect(formBar(0, 12.3).widthPct).toBe(6);
  });

  it("states both numbers in its tooltip", () => {
    expect(formBar(14.1, 12.3).tip).toBe("Recent 3 14.1 vs Expected PPG 12.3");
  });

  it("never turns a missing number into zero: no bar and no Hot or Cold", () => {
    const none = formBar(null, 12.3);
    expect(none.kind).toBe("unknown");
    expect(none.widthPct).toBeNull();
    expect(none.label).toBe("No recent games");
    expect(formBar(10, null).kind).toBe("unknown");
    expect(formBar(10, 0).kind).toBe("unknown");
    expect(formBar(null, 12.3).tip).toBe("Recent 3 — vs Expected PPG 12.3");
  });
});

describe("hero names and positions", () => {
  it("splits the first name from the last name, keeping suffixes with the last name", () => {
    expect(splitName("Jalen Mercer", "QB")).toEqual({
      first: "Jalen",
      last: "Mercer",
    });
    expect(splitName("Amon-Ra St. Brown", "WR")).toEqual({
      first: "Amon-Ra",
      last: "St. Brown",
    });
    expect(splitName("Marvin Harrison Jr.", "WR")).toEqual({
      first: "Marvin",
      last: "Harrison Jr.",
    });
    expect(splitName("Madonna", "WR")).toEqual({ first: "", last: "Madonna" });
  });

  it("shows the team name then D/ST for a defense", () => {
    expect(splitName("Summit Hawks", "D/ST")).toEqual({
      first: "Summit Hawks",
      last: "D/ST",
    });
  });

  it("spells the position out in full", () => {
    expect(positionName("WR")).toBe("Wide receiver");
    expect(positionName("D/ST")).toBe("Defense / special teams");
    expect(positionName("K")).toBe("Kicker");
    expect(positionName("XYZ")).toBe("XYZ");
  });
});

describe("tier badge", () => {
  it("has a name, an accessible replay label and a tooltip that states the rank", () => {
    expect(tierBadge("superstar", 1)).toEqual({
      tier: "superstar",
      text: "★ Superstar",
      aria: "Superstar, replay the card entrance",
      tip: "#1 in fantasy points per game across every position (minimum 4 games). Click to replay.",
    });
    expect(tierBadge("star", 13)?.text).toBe("Star");
    expect(tierBadge("good", 40)?.aria).toBe("Good, replay the card entrance");
  });

  it("has no badge without a tier", () => {
    expect(tierBadge(null, null)).toBeNull();
  });
});

import {
  heroShade,
  whiteContrast,
  breadcrumb,
} from "../src/domain/view/player-hero";
import { nflTeamCodes, teamColors } from "../src/domain/view/nfl-colors";

describe("hero legibility on every team colour (white text, WCAG 4.5:1)", () => {
  it("white text reaches 4.5:1 on every team colour once the hero's darkening is applied", () => {
    expect(nflTeamCodes.length).toBeGreaterThanOrEqual(32);
    for (const code of nflTeamCodes) {
      const { background } = teamColors(code);
      const shade = heroShade(background);
      expect(shade).toBeGreaterThanOrEqual(0.08);
      expect(shade).toBeLessThan(0.75);
      expect(whiteContrast(background, shade), code).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });

  it("darkens only as much as needed: a dark colour keeps the base darkening", () => {
    expect(heroShade("#0b162a")).toBe(0.08);
    expect(heroShade("#fb4f14")).toBeGreaterThan(0.08);
  });
});

describe("hero breadcrumb", () => {
  it("names the screen the card was opened from", () => {
    expect(breadcrumb("#/players")).toBe("Gameday / Scouting / Player card");
    expect(breadcrumb("#/roster")).toBe("Gameday / Roster / Player card");
    expect(breadcrumb("#/trade")).toBe("Gameday / Trade room / Player card");
    expect(breadcrumb("#/player/5")).toBe("Gameday / Player card");
    expect(breadcrumb("")).toBe("Gameday / Player card");
  });
});
