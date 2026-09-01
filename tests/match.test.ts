import { describe, expect, it } from "vitest";

import { MATCH_MIN_SCORE, matchChains, scoreChain } from "../src/builtins";

const chain = (name: string, description: string) => ({ name, description });

// Real descriptions from the reference library — the matcher is only useful if
// it works on the wording people actually write, not on fixtures shaped to pass.
const LIBRARY = [
  chain(
    "root-cause-isolation",
    'Root-cause isolation for environment/config-class problems rather than program logic. Use when "silently fails", "worked yesterday, broken today", "only breaks in one environment", or a hook/setting/registration isn\'t taking effect.',
  ),
  chain(
    "bug-diagnosis",
    "Diagnosis loop for ordinary program bugs. Use when a test fails, behavior is wrong, output is incorrect, or something crashes.",
  ),
  chain(
    "yagni-pass",
    'YAGNI / minimalism ladder for code about to be written or reviewed. Use when "do we need this", adding a dependency, writing an abstraction, or code smells over-engineered.',
  ),
  chain(
    "ui-implementation",
    "Staged flow for UI work. Use when changing UI, CSS/layout, component redesign, visual polish, or matching a reference design.",
  ),
];

describe("scoreChain", () => {
  it("a quoted trigger phrase alone clears the threshold", () => {
    const s = scoreChain(LIBRARY[0], "this worked yesterday, broken today and I cannot see why");
    expect(s).toBeGreaterThanOrEqual(MATCH_MIN_SCORE);
  });

  it("the chain's own name clears the threshold, hyphenated or spaced", () => {
    expect(scoreChain(LIBRARY[2], "give this a yagni-pass")).toBeGreaterThanOrEqual(MATCH_MIN_SCORE);
    expect(scoreChain(LIBRARY[2], "run a yagni pass over it")).toBeGreaterThanOrEqual(MATCH_MIN_SCORE);
  });

  it("unquoted trigger wording still scores through word overlap", () => {
    expect(scoreChain(LIBRARY[1], "a test fails and the output is incorrect")).toBeGreaterThanOrEqual(
      MATCH_MIN_SCORE,
    );
  });

  it("one incidental word is not a match", () => {
    // "design" appears in ui-implementation's trigger, but one word is score 1.
    expect(scoreChain(LIBRARY[3], "explain the design of this module")).toBeLessThan(MATCH_MIN_SCORE);
  });

  it("word matching respects boundaries", () => {
    // "test" must not match inside "latest".
    expect(scoreChain(chain("x", "Use when a test fails."), "the latest release")).toBe(0);
  });
});

describe("matchChains", () => {
  it("returns the matching chains first and everything else as rest", () => {
    const r = matchChains(LIBRARY, "it worked yesterday, broken today");
    expect(r.matched.map((c) => c.name)).toContain("root-cause-isolation");
    expect(r.rest.map((c) => c.name)).not.toContain("root-cause-isolation");
    expect(r.matched.length + r.rest.length).toBe(LIBRARY.length);
  });

  it("higher scores come first", () => {
    const r = matchChains(LIBRARY, "yagni-pass: do we need this dependency at all");
    expect(r.matched[0].name).toBe("yagni-pass");
  });

  it("a prompt in another language matches nothing, and that is the safe answer", () => {
    // The chains are written in English; a Chinese prompt scores zero. The
    // caller must then fall back to showing every chain, not to showing none.
    const r = matchChains(LIBRARY, "這個測試壞掉了，幫我看一下");
    expect(r.matched).toEqual([]);
    expect(r.rest).toHaveLength(LIBRARY.length);
  });

  it("an empty prompt matches nothing", () => {
    expect(matchChains(LIBRARY, "").matched).toEqual([]);
    expect(matchChains(LIBRARY, "   ").rest).toHaveLength(LIBRARY.length);
  });
});
