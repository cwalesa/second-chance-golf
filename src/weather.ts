import { hash2 } from './terrain';

/**
 * Each day has its weather, worked out from the course's land seed and the day number, so it is the same after a
 * reload and uses none of the simulation's random numbers. Courses without generated land (test fixtures) are always clear.
 */
export type Weather = 'clear' | 'rain' | 'heat' | 'storm';

export interface WeatherDef {
  name: string;
  /** shown beside the day in the header */
  mark: string;
  /** multiplier on how many golfers come */
  demand: number;
  /** multiplier on turf wear */
  wear: number;
  /** what it means for the player, in one line */
  note: string;
}
export const WEATHER: Record<Weather, WeatherDef> = {
  clear: { name: 'Clear', mark: '', demand: 1, wear: 1, note: 'A fine day for golf.' },
  rain: { name: 'Rain', mark: '☂', demand: 0.6, wear: 1, note: 'Fewer golfers come out in the rain, but the turf recovers a little.' },
  heat: { name: 'Heatwave', mark: '☀', demand: 0.85, wear: 1.5, note: 'Turf wears half as fast again in the heat, and a few golfers stay home.' },
  storm: { name: 'Storm', mark: '⚡', demand: 0.3, wear: 1, note: 'Very few golfers today. The storm washed out patches of turf on your holes: repair them.' },
};

/** Chance of each kind of bad weather per day, by region. Summer doubles the chance of a heatwave. */
const ODDS: Record<string, { storm: number; rain: number; heat: number }> = {
  parkland: { storm: 0.04, rain: 0.16, heat: 0.03 },
  plains: { storm: 0.05, rain: 0.12, heat: 0.05 },
  coast: { storm: 0.07, rain: 0.17, heat: 0.02 },
  mountain: { storm: 0.07, rain: 0.15, heat: 0.01 },
  desert: { storm: 0.02, rain: 0.03, heat: 0.16 },
};
/** The first days of a course are always clear, so the weather never lands on someone still learning. */
export const WEATHER_GRACE_DAYS = 5;

export function weatherOn(seed: number | undefined, day: number, region: string, season: number): Weather {
  if (!seed || day <= WEATHER_GRACE_DAYS) return 'clear';
  const o = ODDS[region] ?? ODDS.parkland;
  const r = hash2(day, 77, seed % 1000003);
  const heat = o.heat * (season === 1 ? 2 : 1);
  if (r < o.storm) return 'storm';
  if (r < o.storm + o.rain) return 'rain';
  if (r < o.storm + o.rain + heat) return 'heat';
  return 'clear';
}
