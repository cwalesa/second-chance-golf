# Second Chance Golf

A working prototype of a golf course restoration and management game. You bought a struggling public course: repair it, redesign its holes, watch customers play, read their feedback, and reinvest what they spend.

Original art, writing and code. Everything is drawn procedurally on a canvas; nothing is downloaded at runtime.

## Run it

Requires Node 18+.

```bash
npm install
npm run dev        # http://127.0.0.1:5173
```

Other scripts:

```bash
npm test           # simulation, economy, save/load and fuzz tests (vitest)
npm run typecheck
npm run build      # production build into dist/
npm run preview    # serve the production build
```

Progress autosaves to the browser's localStorage. **Reset** (top right) asks for confirmation and starts a new game.

## Phone and tablet

The game is built mobile-first and runs as an installable web app (PWA): open it in Safari or Chrome on a phone and use Add to Home Screen. It plays fullscreen, works offline after the first load, and saves on the device.

For App Store / Play Store builds the project includes a Capacitor config (`capacitor.config.json`). On a Mac with Xcode (iOS) or a machine with Android Studio:

```bash
npx cap add ios      # once
npx cap add android  # once
npm run cap:ios      # builds, syncs and opens Xcode
npm run cap:android  # builds, syncs and opens Android Studio
```

The native projects have not been generated or tested in this repository; the web build is what has been verified.

## How to play

- **Watch first.** Two holes are open. Golfers arrive, pay a green fee, queue at tees, play, spend at the clubhouse and leave. Their comments (speech bubbles and the Guests tab) come from what actually happened to them.
- **Inspect** (default tool): click a hole, golfer or tile. **Pan**: drag. Mouse wheel / pinch zooms. Middle-drag and Space+drag also pan.
- **Paint tools** (Fairway, Rough, Bunker, Water, Repair, Plant/Clear tree): the footprint is outlined, tiles that will change are tinted, and the bottom pill shows tiles and cost before you commit. Drag to paint a stroke; it is charged once on release, only for tiles that change, and is one Undo step. Brush size is under the toolbar.
- **Move tee / Move cup** act on the hole selected in the Course tab.
- Editing any ground belonging to an open hole closes that hole (golfers on it move on). Reopen it from the Course tab once it validates.
- **Regions**: pick Parkland, Coastal Links, Mountain Highlands, Prairie Plains or Desert Oasis at the start. Each changes look, costs, demand, wind, altitude and how the four seasons treat your tee sheet.
- **Tee times**: set separate fees for early bird, midday and twilight. Guests compare each fee with what they think is fair.
- **Club tab**: upgrade the clubhouse through five tiers (rating-gated), see your 0 to 5 star rating, design your logo and name, and work through 30 goals. **Land**: buy locked parcels, then use **New hole** to build up to 18 holes.
- **Time away**: when you return, your course has earned a modest amount while you were gone (up to six days).
- **Events** (Events tab): book a charity scramble, corporate outing, junior clinic or league day for an upcoming day. You set the entry fee (higher fees shrink turnout), setup is charged only when the event starts, and a burst of paying golfers arrives at a 7 AM shotgun start. Some events need open holes, reputation or good turf.
- **Money tab**: green fee, cart price and permanent improvements (snack bar, putting green, driving range, carts, pro shop, grounds crew), each with hourly upkeep and a visible building on the map.
- **Goals** (Goals tab) pay one-time bonuses: repair hole 2's green, reopen hole 3, finish a profitable day with satisfaction 80+.

Shortcuts: `P` pause, `[` `]` brush size, `Ctrl/Cmd+Z` undo, `Esc` back to Inspect.

## Code layout (`src/`)

| File | Responsibility |
| --- | --- |
| `config.ts` | All tuning values (costs, golfer skill, economy, goals, timing) |
| `terrain.ts` | Tile world, starting property, hole zones, validation, route field, walk pathfinding |
| `editing.ts` | Tool plans (cost + affected tiles), tee/cup moves, apply/undo |
| `physics.ts` | Lies, shot resolution (trees, water, OB, roll), shot planning, putting |
| `sim.ts` | Golfers, tee queues, hole flow, reactions, wear |
| `progression.ts` | Regions, seasons, tee-time bands, clubhouse tiers, rating |
| `goals.ts` | Long-term milestones |
| `logo.ts`, `start.ts` | Logo drawing/designer and the new-game screen |
| `events.ts` | Event definitions, turnout and requirements |
| `economy.ts` | Pricing, arrivals, satisfaction scoring, maintenance |
| `game.ts` | Game state, fixed-step update, ledger, goals, day rollover, undo |
| `save.ts` | localStorage persistence |
| `render.ts` | Canvas drawing (cached terrain, trees, golfers, overlays) |
| `input.ts` | Pointer/touch/keyboard handling, staged strokes, previews |
| `ui.ts`, `style.css` | Top bar, toolbar, inspector tabs, toasts, reset dialog |

Simulation runs on a fixed 1/30 s step independent of rendering; the speed buttons only change how many steps run per frame, so refresh rate never changes the economy.
