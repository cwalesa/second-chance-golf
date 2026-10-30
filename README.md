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

## How to play

- **Watch first.** Two holes are open. Golfers arrive, pay a green fee, queue at tees, play, spend at the clubhouse and leave. Their comments (speech bubbles and the Guests tab) come from what actually happened to them.
- **Inspect** (default tool): click a hole, golfer or tile. **Pan**: drag. Mouse wheel / pinch zooms. Middle-drag and Space+drag also pan.
- **Paint tools** (Fairway, Rough, Bunker, Water, Repair, Plant/Clear tree): the footprint is outlined, tiles that will change are tinted, and the bottom pill shows tiles and cost before you commit. Drag to paint a stroke; it is charged once on release, only for tiles that change, and is one Undo step. Brush size is under the toolbar.
- **Move tee / Move cup** act on the hole selected in the Course tab.
- Editing any ground belonging to an open hole closes that hole (golfers on it move on). Reopen it from the Course tab once it validates.
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
| `events.ts` | Event definitions, turnout and requirements |
| `economy.ts` | Pricing, arrivals, satisfaction scoring, maintenance |
| `game.ts` | Game state, fixed-step update, ledger, goals, day rollover, undo |
| `save.ts` | localStorage persistence |
| `render.ts` | Canvas drawing (cached terrain, trees, golfers, overlays) |
| `input.ts` | Pointer/touch/keyboard handling, staged strokes, previews |
| `ui.ts`, `style.css` | Top bar, toolbar, inspector tabs, toasts, reset dialog |

Simulation runs on a fixed 1/30 s step independent of rendering; the speed buttons only change how many steps run per frame, so refresh rate never changes the economy.
