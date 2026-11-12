import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  actionCue,
  importCue,
  searchCue,
  useFeedback,
  FeedbackProvider,
  type Notify,
} from "../src/ui/feel/feedback";
import * as feelSettings from "../src/ui/feel/settings";

describe("feedback cues", () => {
  it("maps search outcomes: found to success, empty to caution", () => {
    expect(searchCue(true)).toBe("success");
    expect(searchCue(false)).toBe("caution");
  });

  it("maps import outcomes: 0 blocking issues to success, >0 to caution", () => {
    expect(importCue(0)).toBe("success");
    expect(importCue(1)).toBe("caution");
    expect(importCue(4)).toBe("caution");
  });

  it("maps action outcomes: ok to success, failed to caution", () => {
    expect(actionCue(true)).toBe("success");
    expect(actionCue(false)).toBe("caution");
  });
});

describe("useFeedback hook", () => {
  it("defaults to a safe no-op outside FeedbackProvider", () => {
    let captured: Notify | null = null;
    function Consumer() {
      captured = useFeedback();
      return null;
    }
    renderToStaticMarkup(h(Consumer));
    expect(typeof captured).toBe("function");
    expect(() => captured!("tap")).not.toThrow();
  });

  it("delegates to feedback() with the provided settings when mounted inside FeedbackProvider", () => {
    const spy = vi.spyOn(feelSettings, "feedback").mockImplementation(() => {});
    const settings = { sound: true, haptics: false };
    let captured: Notify | null = null;
    function Consumer() {
      captured = useFeedback();
      return null;
    }

    renderToStaticMarkup(
      h(FeedbackProvider, { settings }, h(Consumer)),
    );
    expect(typeof captured).toBe("function");
    captured!("select");

    expect(spy).toHaveBeenCalledWith("select", settings);
    spy.mockRestore();
  });
});
