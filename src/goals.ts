// Long-term milestones. The three starter goals live in config; these keep the game going afterwards.
export interface GoalCtx {
  stars: number;
  clubLevel: number;
  holeCount: number;
  openHoleCount: number;
  parcelsOwned: number;
  upgradeCount: number;
  cash: number;
  stats: { rounds: number; revenue: number; events: number; aces: number; bestDayProfit: number; bestDaySat: number; years: number };
}
export interface Milestone {
  id: string;
  title: string;
  detail: string;
  reward: number;
  progress: (g: GoalCtx) => [number, number];
}
const m = (id: string, title: string, detail: string, reward: number, progress: Milestone['progress']): Milestone => ({ id, title, detail, reward, progress });

export const MILESTONES: Milestone[] = [
  m('holes4', 'Build a fourth hole', 'Use the Build hole tool, then open the new hole.', 300, (g) => [g.openHoleCount, 4]),
  m('club2', 'Upgrade to a real clubhouse', 'Reach clubhouse level 2 from the Club tab.', 500, (g) => [g.clubLevel + 1, 2]),
  m('star1', 'One-star course', 'Raise your course rating to 1 star.', 300, (g) => [g.stars, 1]),
  m('rounds50', '50 rounds played', 'Welcome 50 finished rounds.', 350, (g) => [g.stats.rounds, 50]),
  m('events1', 'Host your first event', 'Run any event from the Events tab.', 300, (g) => [g.stats.events, 1]),
  m('amen3', 'Three amenities', 'Own three improvements from the Money tab.', 500, (g) => [g.upgradeCount, 3]),
  m('land2', 'Expand the property', 'Buy two more parcels of land.', 600, (g) => [g.parcelsOwned - 9, 2]),
  m('holes6', 'Six-hole course', 'Have six open holes.', 800, (g) => [g.openHoleCount, 6]),
  m('star2', 'Two-star course', 'Raise your course rating to 2 stars.', 700, (g) => [g.stars, 2]),
  m('rev5k', 'Earn $5,000 in revenue', 'Lifetime fees and sales.', 700, (g) => [g.stats.revenue, 5000]),
  m('holes9', 'A full nine', 'Have nine open holes.', 1500, (g) => [g.openHoleCount, 9]),
  m('club3', 'Country club status', 'Reach clubhouse level 3.', 1500, (g) => [g.clubLevel + 1, 3]),
  m('ace1', 'A hole in one', 'Have a guest ace one of your holes.', 1000, (g) => [g.stats.aces, 1]),
  m('star3', 'Three-star course', 'Raise your course rating to 3 stars.', 2000, (g) => [g.stars, 3]),
  m('events5', 'Event host', 'Host five events.', 1500, (g) => [g.stats.events, 5]),
  m('day1k', 'A $1,000 day', 'Make $1,000 operating profit in one day.', 2000, (g) => [g.stats.bestDayProfit, 1000]),
  m('rounds500', '500 rounds played', 'A busy course.', 2500, (g) => [g.stats.rounds, 500]),
  m('land6', 'Land baron', 'Own 6 extra parcels.', 3000, (g) => [g.parcelsOwned - 9, 6]),
  m('holes12', 'Twelve holes', 'Have twelve open holes.', 4000, (g) => [g.openHoleCount, 12]),
  m('rev50k', 'Earn $50,000 in revenue', 'Lifetime fees and sales.', 4000, (g) => [g.stats.revenue, 50000]),
  m('star4', 'Four-star course', 'Raise your course rating to 4 stars.', 5000, (g) => [g.stars, 4]),
  m('club4', 'Grand clubhouse', 'Reach clubhouse level 4.', 5000, (g) => [g.clubLevel + 1, 4]),
  m('sat90', 'Delighted guests', 'Finish a day with average satisfaction of 90 or more.', 4000, (g) => [g.stats.bestDaySat, 90]),
  m('holes18', 'Eighteen holes', 'The full championship layout.', 10000, (g) => [g.openHoleCount, 18]),
  m('year2', 'A second year', 'Play through a second year.', 6000, (g) => [g.stats.years, 2]),
  m('star5', 'Five-star destination', 'The pinnacle of the rating.', 20000, (g) => [g.stars, 5]),
  m('club5', 'Resort lodge', 'Build the top clubhouse.', 15000, (g) => [g.clubLevel + 1, 5]),
  m('rev500k', 'Earn $500,000 in revenue', 'Lifetime fees and sales.', 25000, (g) => [g.stats.revenue, 500000]),
];
