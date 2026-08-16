/**
 * Browser workspace toolbar geometry. The single-row eight-column template
 * needs more than a 640 px `sm` viewport after outer/inner padding; keep the
 * compact two-row template until `md`.
 */

export const BROWSER_TOOLBAR_ICON_PX = 44;
export const BROWSER_TOOLBAR_FIELD_MIN_PX = 160;
export const BROWSER_TOOLBAR_SINGLE_ROW_GAPS = 7;
export const BROWSER_TOOLBAR_SINGLE_ROW_BREAKPOINT = "md";

export const BROWSER_WORKSPACE_TOOLBAR_NAV_CLASS =
  "grid grid-cols-[2.75rem_minmax(0,1fr)_repeat(3,2.75rem)] items-center gap-1 px-1.5 py-1 md:grid-cols-[2.75rem_minmax(10rem,4fr)_repeat(3,2.75rem)_minmax(10rem,5fr)_repeat(2,2.75rem)] md:gap-1.5 md:px-2 md:py-1.5 lg:gap-2 lg:px-3 lg:py-2";

export function browserToolbarSingleRowMinContentPx(gapPx: number): number {
  return (
    BROWSER_TOOLBAR_ICON_PX +
    BROWSER_TOOLBAR_FIELD_MIN_PX +
    3 * BROWSER_TOOLBAR_ICON_PX +
    BROWSER_TOOLBAR_FIELD_MIN_PX +
    2 * BROWSER_TOOLBAR_ICON_PX +
    BROWSER_TOOLBAR_SINGLE_ROW_GAPS * gapPx
  );
}

export function browserToolbarAvailablePx(
  viewportPx: number,
  outerPadPx: number,
  innerPadPx: number,
): number {
  return viewportPx - outerPadPx - innerPadPx;
}

export function browserToolbarSingleRowFits(
  viewportPx: number,
  outerPadPx: number,
  innerPadPx: number,
  gapPx: number,
): boolean {
  return (
    browserToolbarAvailablePx(viewportPx, outerPadPx, innerPadPx) >=
    browserToolbarSingleRowMinContentPx(gapPx)
  );
}
