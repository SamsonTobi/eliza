/**
 * Pins the Browser toolbar single-row breakpoint above the 640–653 px clip
 * band: eight-column minima plus padding do not fit `sm`, so production stays
 * two-row until `md`.
 */
import { describe, expect, it } from "vitest";
import {
  BROWSER_TOOLBAR_SINGLE_ROW_BREAKPOINT,
  BROWSER_WORKSPACE_TOOLBAR_NAV_CLASS,
  browserToolbarSingleRowFits,
  browserToolbarSingleRowMinContentPx,
} from "./browser-workspace-toolbar-layout";

describe("browser workspace toolbar geometry", () => {
  it("keeps the eight-column template at md, not sm", () => {
    expect(BROWSER_TOOLBAR_SINGLE_ROW_BREAKPOINT).toBe("md");
    expect(BROWSER_WORKSPACE_TOOLBAR_NAV_CLASS).toContain(
      "md:grid-cols-[2.75rem_minmax(10rem,4fr)_repeat(3,2.75rem)_minmax(10rem,5fr)_repeat(2,2.75rem)]",
    );
    expect(BROWSER_WORKSPACE_TOOLBAR_NAV_CLASS).not.toContain("sm:grid-cols-[");
  });

  it("does not fit the eight-column row at 640 or 653 with a long-URL field minimum", () => {
    const gapPx = 6;
    const outerPadPx = 12;
    const innerPadPx = 16;
    expect(browserToolbarSingleRowMinContentPx(gapPx)).toBe(626);
    expect(
      browserToolbarSingleRowFits(640, outerPadPx, innerPadPx, gapPx),
    ).toBe(false);
    expect(
      browserToolbarSingleRowFits(653, outerPadPx, innerPadPx, gapPx),
    ).toBe(false);
    expect(
      browserToolbarSingleRowFits(768, outerPadPx, innerPadPx, gapPx),
    ).toBe(true);
  });
});
