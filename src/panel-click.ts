/**
 * Which control inside the side panel a click means, or null when the click was on nothing that does anything.
 *
 * The page's <body> carries a `data-tab` attribute of its own (the stylesheet reads it), so a plain `closest('[data-tab]')`
 * from any click inside the panel walks all the way up and finds the body. Taking that for a tab press rebuilt the panel
 * in the middle of the click, throwing away the section header that was being pressed: Edit hole and every other
 * collapsible section looked dead. A control only counts if it lives inside the panel itself.
 */
export interface ClickNode {
  closest(selector: string): ClickNode | null;
}
export interface PanelRoot extends ClickNode {
  contains(other: unknown): boolean;
}
export const PANEL_CONTROL = '[data-tab],[data-act],[data-hole]';

export function panelControl<T extends ClickNode>(target: ClickNode | null, side: PanelRoot): T | null {
  const el = target?.closest(PANEL_CONTROL) ?? null;
  if (!el || el === (side as unknown) || !side.contains(el)) return null;
  return el as T;
}
