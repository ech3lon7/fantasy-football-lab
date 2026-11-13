import { describe, expect, it } from "vitest";
import {
  mergeTradeSettings,
  readTradeSettings,
} from "../src/features/next/trade/tradeSettings";
import { readChainPreferences } from "../src/features/next/trade/useChainSearch";

const chainPart = (extra: object = {}) =>
  JSON.stringify({
    query: { team: "1", pool: ["3"], first: {}, second: {}, ...extra },
    controls: { loss: "3", gain: "5", recipientLoss: "10", recipientGain: "1" },
    firstOverride: false,
    secondOverride: false,
    preset: "balanced",
  });

describe("trade search settings", () => {
  it("each screen writes only its own part and keeps the other as stored", () => {
    const standard = JSON.stringify({
      query: { give: ["1"] },
      controls: { a: 1 },
    });
    const one = mergeTradeSettings(undefined, "standard", standard);
    const two = mergeTradeSettings(one, "chain", chainPart());
    const read = readTradeSettings(two);
    expect(read.standard).toEqual(JSON.parse(standard));
    expect(read.chain).toBeDefined();
    const three = mergeTradeSettings(
      two,
      "standard",
      JSON.stringify({ query: { give: ["2"] }, controls: {} }),
    );
    expect(readTradeSettings(three).chain).toEqual(read.chain);
  });

  it("unreadable or other-version records count as no saved settings", () => {
    expect(readTradeSettings("not json")).toEqual({});
    expect(readTradeSettings(JSON.stringify({ version: 2 }))).toEqual({});
  });

  it("chain preferences load from the shared record", () => {
    const raw = mergeTradeSettings(undefined, "chain", chainPart());
    expect(readChainPreferences(raw)?.preset).toBe("balanced");
    expect(readChainPreferences(undefined)).toBeUndefined();
  });

  it("an earlier chain record with strictness loads into the single method, dropping only the level", () => {
    const legacy = JSON.stringify({
      ...JSON.parse(chainPart()),
      strictness: "negotiable",
      preset: "mutual",
      customPresets: [
        {
          id: "p",
          name: "Mine",
          query: { team: "1" },
          strictness: "conservative",
        },
      ],
    });
    const read = readChainPreferences(undefined, legacy)!;
    expect(read.preset).toBe("mutual");
    expect("strictness" in read).toBe(false);
    expect(read.customPresets?.[0].name).toBe("Mine");
    expect("strictness" in read.customPresets![0]).toBe(false);
  });
});
