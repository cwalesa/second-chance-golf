// The club's saved logo. The drawing lives in crest.ts (an SVG identity system); this file keeps the saved shape of the data,
// including the older fields (shape, colours, icon, pattern, lettering) that saves from before the redesign carry and that
// crest.ts maps onto the nearest new identity.
export type LogoShape = 'circle' | 'shield' | 'rounded' | 'diamond' | 'hexagon' | 'octagon' | 'oval' | 'banner' | 'rosette' | 'arch';
export type LogoIcon =
  | 'flag' | 'ball' | 'club' | 'tree' | 'sun' | 'wave' | 'peak' | 'cactus'
  | 'crossed' | 'tee' | 'birdie' | 'leaf' | 'anchor' | 'crown' | 'star' | 'trophy' | 'pine' | 'lighthouse';
/** What fills the background behind the emblem, drawn in the accent colour. */
export type LogoPattern = 'plain' | 'stripes' | 'hoops' | 'chevron' | 'halves' | 'quarters' | 'sash' | 'inset' | 'dots' | 'rays';
/** How the initials are lettered, or none. */
export type LogoLettering = 'serif' | 'bold' | 'script' | 'none';
export interface Logo {
  shape: LogoShape;
  primary: string;
  secondary: string;
  icon: LogoIcon;
  initials: string;
  /** Older saves have neither: they draw as plain with serif initials, exactly as before. */
  pattern?: LogoPattern;
  lettering?: LogoLettering;
  /** The club identity (crest.ts): construction, symbol and palette. Older saves have none and map to the nearest one. */
  style?: string;
  symbol?: string;
  palette?: string;
}
export const defaultLogo = (): Logo => ({ shape: 'circle', primary: '#1f4a35', secondary: '#b8975a', icon: 'leaf', initials: 'WC', pattern: 'plain', lettering: 'serif', style: 'seal', symbol: 'willow', palette: 'forest' });

export { initialsFor as initialsOf } from './crest';
