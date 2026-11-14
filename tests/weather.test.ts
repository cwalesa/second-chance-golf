import { describe, expect, it } from 'vitest';
import { Game } from '../src/game';
import { WEATHER, WEATHER_GRACE_DAYS, weatherOn } from '../src/weather';
import { createTestCourse } from './fixtures/classic-course';

describe('weather', () => {
  it('is always clear without generated land and in the first days of a course', () => {
    for (let d = 1; d < 200; d++) expect(weatherOn(undefined, d, 'parkland', 0)).toBe('clear');
    for (let d = 1; d <= WEATHER_GRACE_DAYS; d++) expect(weatherOn(12345, d, 'coast', 0)).toBe('clear');
    expect(new Game(createTestCourse()).weather).toBe('clear');
  });
  it('is the same for the same course and day, mostly clear, and brings every kind sooner or later', () => {
    const seen: Record<string, number> = {};
    for (let d = 6; d < 606; d++) {
      const w = weatherOn(4242, d, 'coast', Math.floor(d / 4) % 4);
      expect(weatherOn(4242, d, 'coast', Math.floor(d / 4) % 4)).toBe(w);
      seen[w] = (seen[w] ?? 0) + 1;
    }
    expect(seen.clear).toBeGreaterThan(360);
    expect(seen.rain).toBeGreaterThan(40);
    expect(seen.storm).toBeGreaterThan(10);
    expect(seen.heat).toBeGreaterThan(0);
  });
  it('the desert is hot and dry', () => {
    let heat = 0, rain = 0;
    for (let d = 6; d < 606; d++) { const w = weatherOn(99, d, 'desert', 1); if (w === 'heat') heat++; if (w === 'rain') rain++; }
    expect(heat).toBeGreaterThan(rain * 3);
  });
  it('bad weather keeps golfers away', () => {
    expect(WEATHER.storm.demand).toBeLessThan(WEATHER.rain.demand);
    expect(WEATHER.rain.demand).toBeLessThan(1);
    expect(WEATHER.heat.wear).toBeGreaterThan(1);
  });
});
