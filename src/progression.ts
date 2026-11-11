// Long-term progression data: regions, seasons, tee-time bands, clubhouse tiers and course rating.
export type RGB = [number, number, number];
export type RegionId = 'parkland' | 'coast' | 'mountain' | 'plains' | 'desert';

export interface Palette {
  roughGood: RGB;
  roughBad: RGB;
  fairGood: RGB;
  fairWorn: RGB;
  greenGood: RGB;
  greenWorn: RGB;
  teeGood: RGB;
  dirt: RGB;
  sand: RGB;
  sandRim: RGB;
  water: RGB;
  waterDeep: RGB;
  path: RGB;
}

export interface Region {
  id: RegionId;
  name: string;
  /** Plain difficulty label shown on the start screen. */
  difficulty: string;
  /** 1 (easiest) to 5 (hardest). */
  level: number;
  /** A sentence or two on the land and what it asks of you. */
  blurb: string;
  tagline: string;
  perks: string[];
  palette: Palette;
  /** Weights for tree sprite variants: 0 broadleaf, 1 dark broadleaf, 2 pine, 4 dry, 5 palm, 6 scrub. */
  trees: number[];
  treeDensity: number;
  waste: number; // how much natural sand/scrub ground surrounds the course
  demand: number;
  /** Visitors' spending in the shop and grill. */
  spend: number;
  fairMult: number;
  buildMult: number;
  landMult: number;
  wear: number;
  upkeep: number;
  wind: number; // widens every golfer's dispersion
  distance: number; // thin air makes the ball fly farther
  /** per season (spring, summer, autumn, winter) */
  seasonDemand: [number, number, number, number];
  seasonWear: [number, number, number, number];
}

// Sunny and bright, like a summer afternoon: warm meadow greens, pale sandy paths and clear turquoise water.
const base: Palette = {
  roughGood: [84, 152, 66], roughBad: [138, 150, 78], fairGood: [124, 196, 82], fairWorn: [176, 160, 96], greenGood: [146, 216, 104], greenWorn: [170, 160, 100],
  teeGood: [132, 206, 92], dirt: [168, 134, 90], sand: [248, 234, 194], sandRim: [210, 182, 122], water: [74, 190, 204], waterDeep: [34, 128, 172], path: [230, 218, 190],
};

export const REGIONS: Record<RegionId, Region> = {
  parkland: {
    id: 'parkland', name: 'Forest', difficulty: 'Easy', level: 1,
    blurb: 'Meadows and clearings between tall trees. Plenty of room to build, steady golfers all year and forgiving costs.',
    tagline: 'Lush, classic and forgiving.',
    perks: ['Generous clearings', 'Steady demand all year', 'Forgiving costs'],
    palette: base, trees: [0.4, 0.3, 0.3, 0, 0, 0, 0], treeDensity: 1, waste: 0,
    demand: 1.05, spend: 1, fairMult: 1, buildMult: 1, landMult: 1, wear: 1, upkeep: 0.92, wind: 1, distance: 1,
    seasonDemand: [1, 1.1, 1, 0.8], seasonWear: [1, 1.05, 1, 0.8],
  },
  coast: {
    id: 'coast', name: 'Coast', difficulty: 'Medium', level: 3,
    blurb: 'Shoreline, dunes and sea views. Visitors spend more, but the wind pushes every shot around.',
    tagline: 'Windswept dunes and sea views.',
    perks: ['Visitors spend more', 'Stronger wind', 'Busy summers'],
    palette: { ...base, roughGood: [88, 142, 70], roughBad: [150, 150, 84], fairGood: [118, 182, 84], fairWorn: [170, 154, 98], greenGood: [124, 196, 100], water: [48, 150, 196], waterDeep: [30, 108, 160], sand: [240, 226, 178] },
    trees: [0.05, 0, 0.15, 0, 0.1, 0.1, 0.6], treeDensity: 0.35, waste: 0.7,
    demand: 1.05, spend: 1.3, fairMult: 1.08, buildMult: 1.1, landMult: 1.3, wear: 1, upkeep: 1, wind: 1.2, distance: 1,
    seasonDemand: [0.95, 1.3, 1, 0.7], seasonWear: [1, 1, 1, 0.9],
  },
  mountain: {
    id: 'mountain', name: 'Mountains', difficulty: 'Hard', level: 4,
    blurb: 'Rugged slopes and dense pines. Building costs more and winter nearly empties the course.',
    tagline: 'Thin air, tall pines, short summers.',
    perks: ['Dense pine forest', 'Costly construction', 'Busy summers, empty winters'],
    palette: { ...base, roughGood: [46, 112, 64], roughBad: [100, 128, 70], fairGood: [88, 164, 86], fairWorn: [146, 136, 92], greenGood: [104, 182, 98], water: [52, 128, 190], waterDeep: [32, 96, 156], path: [176, 172, 164] },
    trees: [0, 0.1, 0.8, 0, 0.1, 0, 0], treeDensity: 1.5, waste: 0,
    demand: 0.95, spend: 1, fairMult: 1.05, buildMult: 1.25, landMult: 0.9, wear: 1.05, upkeep: 1.05, wind: 1, distance: 1.08,
    seasonDemand: [0.9, 1.3, 1.1, 0.35], seasonWear: [1, 1, 1.05, 1.4],
  },
  plains: {
    id: 'plains', name: 'Prairie', difficulty: 'Easy to medium', level: 2,
    blurb: 'Open grassland with few trees. Building is cheap, but green fees are lower and the breeze never quite stops.',
    tagline: 'Wide open, cheap land, steady breeze.',
    perks: ['Cheaper construction', 'Lower green fees', 'Some wind'],
    palette: { ...base, roughGood: [112, 148, 66], roughBad: [160, 150, 80], fairGood: [128, 184, 82], fairWorn: [176, 156, 96], greenGood: [130, 202, 98], path: [198, 186, 160] },
    trees: [0.45, 0.1, 0.1, 0, 0.35, 0, 0], treeDensity: 0.4, waste: 0.1,
    demand: 0.95, spend: 1, fairMult: 0.9, buildMult: 0.85, landMult: 0.7, wear: 1, upkeep: 0.95, wind: 1.1, distance: 1,
    seasonDemand: [1, 1.05, 1, 0.65], seasonWear: [1, 1.05, 1, 0.8],
  },
  desert: {
    id: 'desert', name: 'Desert', difficulty: 'Very hard', level: 5,
    blurb: 'Sand, scrub and a few oases. Turf is costly to keep green, but golfers will pay the most to play here.',
    tagline: 'Green ribbons in a golden wilderness.',
    perks: ['Highest green fees', 'Costly turf upkeep', 'Sparse vegetation'],
    palette: { ...base, roughGood: [150, 150, 84], roughBad: [186, 160, 98], fairGood: [100, 178, 80], fairWorn: [180, 150, 96], greenGood: [114, 192, 96], sand: [244, 214, 160], sandRim: [208, 168, 104], water: [44, 160, 190], waterDeep: [28, 118, 156], path: [214, 190, 150], dirt: [170, 128, 84] },
    trees: [0, 0, 0, 0, 0.1, 0.45, 0.45], treeDensity: 0.4, waste: 1,
    demand: 0.9, spend: 1, fairMult: 1.3, buildMult: 1.1, landMult: 0.8, wear: 1.35, upkeep: 1.3, wind: 1.03, distance: 1.03,
    seasonDemand: [1.3, 0.55, 1.2, 1.35], seasonWear: [1.1, 1.4, 1, 0.9],
  },
};
export const REGION_IDS = Object.keys(REGIONS) as RegionId[];

export const SEASON_NAMES = ['Spring', 'Summer', 'Autumn', 'Winter'] as const;
export const SEASON_DAYS = 4;
export const seasonIndex = (day: number) => Math.floor((day - 1) / SEASON_DAYS) % 4;
export const yearOf = (day: number) => Math.floor((day - 1) / (SEASON_DAYS * 4)) + 1;

export type BandId = 'early' | 'mid' | 'twilight';
export interface Band {
  id: BandId;
  name: string;
  hours: string;
  from: number; // fraction of the day
  to: number;
  share: number; // share of daily demand
  fair: number; // how the fair price compares with midday
}
export const BANDS: Band[] = [
  { id: 'early', name: 'Early bird', hours: '7 to 10 AM', from: 0, to: 0.25, share: 0.3, fair: 1.1 },
  { id: 'mid', name: 'Midday', hours: '10 AM to 3 PM', from: 0.25, to: 0.667, share: 0.5, fair: 1 },
  { id: 'twilight', name: 'Twilight', hours: '3 to 7 PM', from: 0.667, to: 1, share: 0.2, fair: 0.75 },
];
export const bandAt = (frac: number): Band => BANDS.find((b) => frac < b.to) ?? BANDS[2];

export interface ClubLevel {
  name: string;
  cost: number;
  demand: number;
  fair: number;
  shop: number;
  sat: number;
  holes: number;
  upkeep: number;
  minStars: number;
  blurb: string;
}
export const CLUB_LEVELS: ClubLevel[] = [
  { name: 'Pro shack', cost: 0, demand: 1, fair: 0, shop: 1, sat: 0, holes: 4, upkeep: 0, minStars: 0, blurb: 'A tin-roofed shack and a cash box.' },
  { name: 'Clubhouse', cost: 1800, demand: 1.1, fair: 3, shop: 1.2, sat: 1, holes: 9, upkeep: 4, minStars: 1, blurb: 'A proper counter, lockers and a small grill. Up to 9 holes.' },
  { name: 'Country club', cost: 6000, demand: 1.22, fair: 7, shop: 1.45, sat: 2, holes: 12, upkeep: 9, minStars: 2.5, blurb: 'Dining room, bar and a terrace. Up to 12 holes. Corporate and league events.' },
  { name: 'Grand clubhouse', cost: 16000, demand: 1.36, fair: 12, shop: 1.7, sat: 3, holes: 18, upkeep: 16, minStars: 3.5, blurb: 'Ballroom and locker suites. Up to 18 holes. Hosts regional opens.' },
  { name: 'Resort lodge', cost: 40000, demand: 1.5, fair: 20, shop: 2, sat: 4, holes: 18, upkeep: 28, minStars: 4.5, blurb: 'A destination resort with a spa. Weddings and tournaments.' },
];

export interface RatingInput {
  openHoles: number;
  avgCond: number;
  rep: number;
  amenities: number;
  clubLevel: number;
}
/** Course rating in half-star steps, 0 to 5. */
export function ratingStars(r: RatingInput): number {
  const pts =
    Math.min(40, r.openHoles * 2.3) + // up to 40 for a full set of holes
    (Math.max(0, Math.min(100, r.avgCond)) / 100) * 18 +
    (Math.max(0, Math.min(100, r.rep)) / 100) * 18 +
    Math.min(12, r.amenities * 2.4) +
    r.clubLevel * 3;
  return Math.max(0, Math.min(5, Math.floor((pts - 12) / 8.8) / 2));
}
