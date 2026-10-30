// Central tuning values. Distances are in tiles (1 tile = 10 yards = 30 feet).
export const CFG = {
  grid: { w: 80, h: 50, yardsPerTile: 10, feetPerTile: 30 },

  sim: { dt: 1 / 30, maxStepsPerFrame: 400, speeds: [0, 1, 3, 8] as const },

  day: {
    seconds: 300, // simulated seconds per day at 1x
    startHour: 7,
    hours: 12,
    lastArrivalFrac: 0.88,
    historyKeep: 14,
  },

  economy: {
    startCash: 1800,
    fee: { default: 30, min: 5, max: 90 },
    maintenance: { perHour: 12, perOpenHole: 6, perClosedHole: 2 },
    baseGolfersPerDay: 6,
    golfersPerOpenHole: 4,
    shopBase: 3,
    shopSatFactor: 0.09, // extra dollars per satisfaction point
    proShopMultiplier: 1.6,
      },

  upgrades: {
    proShop: { name: 'Pro shop stock', cost: 700, upkeep: 2, satBonus: 0, blurb: 'Golfers spend about 60% more at the clubhouse.' },
    snackBar: { name: 'Snack bar', cost: 500, upkeep: 3, satBonus: 3, blurb: 'Adds about $4 of food and drink per round and pleases guests.' },
    puttingGreen: { name: 'Practice putting green', cost: 400, upkeep: 1, satBonus: 3, blurb: 'A small warm-up green. Guests rate their day higher.' },
    range: { name: 'Driving range', cost: 900, upkeep: 5, satBonus: 2, blurb: 'Draws about 15% more golfers to the course.' },
    carts: { name: 'Golf carts', cost: 800, upkeep: 3, satBonus: 2, blurb: 'Rent carts for a second fee you set. Higher cart prices mean fewer rentals.' },
    crew: {
      name: 'Grounds crew',
      cost: 600,
      upkeep: 8,
      satBonus: 0,
      blurb: 'Mows and reseeds worn turf each hour and halves wear. Adds $8/hour upkeep.',
      restorePerHour: 1.6,
      restoreCeil: 84,
      wearMultiplier: 0.5,
    },
  },
  extras: { snackSpend: 4, rangeDemand: 1.15, cartFeeDefault: 8, cartFeeMax: 30 },

  costs: {
    fairway: 20,
    fairwayFromHazard: 26,
    rough: 6,
    bunker: 28,
    water: 40,
    treePlant: 12,
    treeRemove: 18,
    repairBase: 1,
    repairPerPoint: 0.05, // per missing condition point
    repairGreenMult: 2,
    moveTeeBase: 40,
    moveTeePerTile: 5,
    moveCupBase: 50,
    moveCupPerTile: 7,
    moveCupSameGreen: 15,
  },

  turf: {
    freshFairway: 86,
    freshRough: 60,
    freshGreen: 85,
    freshTee: 80,
    repairTo: 95,
    repairRoughTo: 78,
    repairThreshold: 88,
    repairRoughThreshold: 70,
    wornBelow: 45,
    floor: 8,
  },

  wear: { teeShot: 1.1, fairwayShot: 0.7, putt: 0.28, cupRadius: 1.3 },

  holes: { zoneRadius: 7, maxOnHole: 4, teeInterval: 8, maxStrokesOverPar: 5, holeTimeout: 160, par3Max: 23, par4Max: 43 },

  golfers: {
    walkSpeed: 3.0,
    types: {
      beginner: { label: 'Beginner', reach: 15, angSigma: 0.125, distSigma: 0.10, mishit: 0.07, puttHalf: 4.5, expectedOver: 1.6, weight: 0.45, shirt: '#e8a23a', cap: '#c6532f' },
      regular: { label: 'Regular', reach: 19, angSigma: 0.085, distSigma: 0.07, mishit: 0.04, puttHalf: 6.5, expectedOver: 0.8, weight: 0.4, shirt: '#3d78c9', cap: '#f2f2f2' },
      skilled: { label: 'Skilled', reach: 25, angSigma: 0.04, distSigma: 0.04, mishit: 0.015, puttHalf: 9, expectedOver: 0.2, weight: 0.15, shirt: '#1f4d3a', cap: '#d8b54a' },
    },
  },

  satisfaction: {
    weights: { price: 0.25, cond: 0.3, diff: 0.25, pace: 0.2 },
    prior: 55,
    window: 20,
    goal: 80,
    goalMinRounds: 8,
  },

  goals: [
    { id: 'green', title: 'Repair the damaged green', detail: 'Hole 2 has a worn-out green. Close it, repair the turf, and reopen.', reward: 250 },
    { id: 'reopen', title: 'Reopen the closed hole', detail: 'Hole 3 is overgrown. Connect a fairway, repair the tee and green, then open it.', reward: 300 },
    { id: 'day', title: 'Complete a profitable day with happy golfers', detail: 'Finish a day with positive operating profit, at least 8 finished rounds and average guest satisfaction of 80 or more.', reward: 400 },
  ],

  tuning: { fairLeniency: 3.2 },
};

export type GolferType = keyof typeof CFG.golfers.types;
