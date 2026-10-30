# Second Chance Golf — First Course Designer (0.6.0)

This version has one job: **design and play Willow Creek, your first course.** Travel, later properties and the campaign portfolio are hidden (the code is still there but unreachable from the interface). No other locations, multiplayer, monetization or App Store work is included.

## Run it

Requires Node 18+.

```bash
npm ci
npm run dev        # http://127.0.0.1:5173
npm test           # unit + simulation tests (vitest)
npm run build      # typecheck + production site into dist/
npm run preview    # serve the production build
```

`dist/` is a ready-built static site (relative paths, so it works from any folder or a GitHub Pages sub-path). The existing GitHub Pages workflow (`.github/workflows/pages.yml`) is unchanged: it tests, builds and publishes `dist/` on push. Replace the matching project files in your repository and commit; do not commit the ZIP itself.

On a phone, open the published site and use Add to Home Screen. Rotate freely (turn system rotation lock off).

## Designing

- **Design** (bottom bar) opens the tray. Tool groups: **Terrain** (fairway, green, rough, path, bunker, water), **Nature** (plant tree, clear tree, repair turf), **Holes** (move tee, move cup, dogleg, new hole). **Select** and **Pan** are always on screen. In landscape the group button cycles through the groups. Brush size (S/M/L) floats at the edge of the map while a paint tool is active.
- **Strokes stack, then you decide.** Everything you paint is previewed in its final colour with a running tile count and price in the confirm bar. **Build** pays once; **Cancel** (or Undo, Esc) throws it all away for free. You can switch tools between strokes and keep stacking.
- **Place and move tees, cups and doglegs** on the hole named in the **hole bar** (‹ name ›) at the top. Tap or drag to a spot: a gold ghost shows the new pins, route and par/yardage, then confirm. **New hole**: tap the tee, tap the green, confirm; a fairway corridor is laid.
- **Shape greens and tees:** rough or fairway paint trims their edges and the Green tool grows a green. The cup and tee centre are protected. Cart paths can be painted over.
- **Undo / Redo** are always on the map. Undo refunds; redo re-charges. Removing a hole is undoable too.
- **Holes** (bottom bar): par, yardage and open/blocked status for every hole, plus rename, remove, **Open/Close**, **Play it** (your own practice round) and **Send test golfers** (three free simulated golfers play that hole). A hole that cannot open lists each reason with a **Show on map** button and a **Fix with <tool>** button.
- You start with **$25,000** and the whole property owned. Up to nine holes. Money is for experimenting; the economy and guest simulation still run underneath.
- Everything saves automatically in the browser (Menu → Save now, export and import backups). Unbuilt strokes are not saved; built changes, hole names, par and open/closed state are.

## What changed in this version

Designer: stacked build batches with confirm/cancel, redo, undoable hole removal, hole bar, grouped touch-size tool tray, floating brush sizes, hole panel with validation explanations, test golfers (no fee, no ratings, no revenue), yardage/par chips on the map, par now computed from the routed length, all land owned, land-buying goals hidden, travel/portfolio removed from the UI, 28 new tests.

Graphics: see the section below.

## Honest limitations

- Verified in Chromium (headless) with real touch input at 390×844 and 844×390 plus other sizes; not on a physical iPhone/Safari. Performance on real devices is untested.
- Unbuilt strokes are lost on reload; the confirm bar always shows what is pending.
- Hole order follows hole numbers; there is no drag-to-reorder.
- Old saves load; their land is opened up and hole 2 may keep its old par.
- 120×80 tile property; nine-hole cap in this version.

---

## Earlier versions

# Second Chance Golf — Jewel & Landscape Update (0.5.0)

A new visual direction inspired by classic isometric golf management games: an angled miniature world, upright buildings and trees, a compact terrain palette, and management screens that open when requested. All artwork is original canvas-generated art; the reference screenshots are not embedded or used as game assets.

## Texture, color and landscape update

- Emerald parkland turf, stronger mowing stripes, bright putting surfaces, ivory sand and turquoise water. Other regions retain their distinct terrain palettes.
- Deterministic, reusable microtexture patterns for grass and rough; fine sand grain with continuous rake lines; subtle water ripples and staggered path paving. Materials are cached into terrain chunks rather than regenerated each frame.
- Midnight-blue and lagoon interface with champagne-gold active controls.
- Portrait and landscape phone layouts. Landscape uses a left navigation rail, an independently scrolling bottom construction tray, a right management drawer, and a right practice panel. Camera framing reserves space for the visible panels.
- Safe-area offsets accommodate landscape notches and home indicators. The web-app manifest permits any orientation; rotate the phone with system rotation lock off.
- Existing saves and gameplay progression remain compatible.

## New visual presentation

- A true isometric ground projection with upright scenery and golfers.
- Three-dimensional clubhouse forms with gabled slate roofs, windows, verandas, chimneys, and larger upgrade-tier silhouettes.
- Upright amenity buildings, garden beds, terrace umbrellas, practice facilities and parked buggies.
- Fine-grained trees, conifers and flowering trees, with depth sorting by projected world position.
- Straight mowing stripes and a lighter daylight treatment.
- A bottom construction palette with miniature terrain-tile previews and compact round navigation controls.
- An unobstructed course on startup. Management panels open through the navigation buttons; selecting the same navigation button closes a panel.
- Isometric brush highlights and parcel outlines. The minimap shows the projected viewport footprint.
- Projection-aware painting, picking, pan, zoom, and selected-hole camera framing.

## Screenshots

The six screenshots in this archive come from the running game. `01_Portrait` shows a new game; the landscape and detail shots use a developed-club fixture to show the upgraded building and amenities. The fixture does not alter a user's save or the starting unlocks. Landscape screenshots include building, management and practice views. These are Chromium viewport captures, not physical iPhone screenshots.

## Validation

81 automated tests passed. This update was browser-checked at landscape viewports 844×390, 932×430, 667×375 and 568×320, plus portrait 390×844 and 320×568. Checks covered rotation, drawer bounds, build-tray scrolling, actual touch painting and undo, practice camera space, and offline reload with 10 cached assets and no browser errors. Earlier automated checks cover camera projection, inverse picking, viewport framing, and cursor-centered zoom. Browser checks also exercised actual pointer-driven painting, exact-tile previews, undo/refunds, drag panning, campaign projects, owner swings, end-of-day reports, travel, archived courses and save recovery. The production website is built into `dist/`. Physical iPhone/WebKit performance and touch behavior still need device testing.

This is an initial art-direction pass. It is a 2.5D canvas renderer with a flat ground plane, not a full 3D terrain engine. More detailed building sprites, varied architectural sets, animation, audio, and sustained device playtesting can continue from this foundation.

## Update your game

Replace matching extracted project files in your existing GitHub repository and commit to `main`. The existing workflow tests, builds and deploys the source. Do not upload only the ZIP as a repository file. `dist/` contains the ready-built static website; `screenshots/` is for review and need not be committed. Existing local saves use the same version-2 save format and defaults.

The live GitHub website has not been changed by preparing this archive.

---

## Previous version reference

# Second Chance Golf — Club Edition (0.3.0)

This update builds on Restoration Edition with guided projects, career progression, a daily closing report, a timing-based swing, and a permanent illustrated course collection. It remains a playable web/Capacitor prototype for an eventual paid iOS game.

## What changed

- **Restoration journal:** a clearer suggested next step, career progress, and separate Your course / Projects / Portfolio views. Phone panels have a close control and larger usable project cards.
- **Quoted projects:** restore the damaged green or reopen a closed hole with construction priced from the actual map. Review the cost before commissioning. Previously open repaired greens reopen if valid. Custom layouts with obstructing hazards may still need manual editing.
- **Career:** earn 2 XP per completed guest round, 12 XP for each new member, 20 XP per profitable closing day, 75 XP per campaign objective, and one-time XP for project types at each property. Repeating or undoing a project cannot farm career XP.
- **Smart irrigation:** $650, unlocks at 160 XP, adds $12 daily upkeep, reduces turf wear 20%, and restores 1 condition/hour up to 88. Sprinklers are visible during watering periods.
- **Clubhouse garden:** $280, adds 2 guest satisfaction, and appears as flower beds and a bench by the clubhouse.
- **Clubhouse terrace:** $480, unlocks at 650 XP, adds 3 guest satisfaction and 15% to clubhouse sales, and appears as a furnished patio.
- **Later career levels:** Course architect at 1,800 XP gives a 5% terrain-construction discount; Resort designer at 4,500 XP gives 10%. Career progress carries between courses. Site improvements reset at each new property.
- **Membership pacing:** at most 2 new members/day, or 3 with a host, so the club develops across days rather than filling immediately.
- **Closing report:** a distinct daily profit statement, income/expenses, guest statistics, recent profit bars, and a relevant next step. Review pauses the browser simulation. Choose to start tomorrow or plan improvements. Reports can be disabled in settings.
- **Swing timing:** choose a club and target, tap Start swing, then Strike as the cursor passes through the center. Early/late contact changes shot direction and carry; timing also affects putting success. Practice remains separate from management income and RNG.
- **Feedback:** optional synthesized swing/build/reward sounds and optional brief vibration on devices that support it. Audio starts only after a gesture. No network audio or music files are required.
- **Course collection:** traveling preserves a read-only illustrated plan and result summary of the completed property. These records survive saves and can be viewed from Portfolio. They are not playable save slots or simulations of old properties.
- **Recovery:** the previous valid save is retained as an automatic backup. A damaged primary save falls back to it. Malformed imports are rejected before replacing current progress. Reset clears both copies. Ordinary manual pauses survive reload; transient practice/design mode resumes normal management after reload.
- **Operating reserve:** one $650 reserve per location when cash is below $150, available from Projects. No purchases or interest.

## Screenshots

The delivered screenshots are captures of the running build during a sample playthrough. They show normal project construction, owner practice, a simulated closing day, and a completed course portfolio. They do not represent the user's live save, and they are not App Store marketing mockups or physical-device captures.

## Run or publish

1. Extract the archive.
2. For GitHub Pages, replace the matching source files in the existing repository and commit to `main`. The existing Actions workflow tests, builds and deploys. Upload the extracted files, not this ZIP as a repository file.
3. For a static host, upload the contents of `dist/`.
4. Local development: `npm ci`, then `npm run dev`.
5. Validation: `npm test` and `npm run build`.

The project uses no remote fonts or gameplay services. Offline assets are precached in the production build. Existing version-2 saves are migrated with defaults for new fields. Export a backup from Menu before a major upgrade, particularly on iOS where site data can be cleared by the browser or device.

## Paid-app status

The included Capacitor configuration is retained; no signed iOS application or Xcode project is included. This version has been checked in Chromium at phone and desktop viewport sizes, including offline production loading and primary-save recovery. WebKit, audio/haptics, thermal/battery behavior, and physical iPhone/iPad controls still need device testing. Career thresholds and prices have been tuned as a first pass; sustained playtesting is still needed to establish the right paid-game length and challenge. A broader art/animation/audio pass and native packaging remain future work.

The live GitHub website has not been changed by preparing this ZIP.

---

## Previous version reference

# Second Chance Golf — Restoration Edition (0.2.0)

A substantial playable update of the supplied prototype. Inspired by the course-building and golfer-watching loop of classic golf management games, with original code and visuals. This is a playtest build, not an App Store release.

## Start here

- **Source:** `src/` plus `package.json`, `package-lock.json`, `index.html`, `vite.config.ts`, and the existing GitHub Pages workflow.
- **Ready-built website:** `dist/`. This folder contains the production HTML, JavaScript, CSS, icons and offline assets. Serve/upload the contents of this folder as a static website. Opening the source HTML directly from Files is not supported.
- **Update GitHub:** extract this archive and replace the matching project files in the existing repository. Commit the source changes to `main`. Do not upload only this ZIP into the repository: GitHub must see the actual project files. The existing workflow runs the tests, builds, and deploys to Pages.
- **Run locally:** `npm ci`, then `npm run dev`. Production verification: `npm test` and `npm run build`.
- The live website has not been modified by producing this archive.

## The gameplay loop

Restore a damaged property → improve its design and turf → watch actual golfers → use their feedback and shot landings → earn fees, shop sales and member dues → collect restoration grants → complete the property’s objectives → choose when to move to the next location.

There are no premium currencies, purchased timers, ads, or in-app purchases in this build.

## Five-course campaign

| Location | Theme | Main objectives | Starting budget |
| --- | --- | --- | --- |
| Willow Creek | Municipal parkland restoration | Two repaired greens, three open holes, 12 rounds, $500 operating profit | $2,400 |
| Dunes & Tide | Windy coastal links | Three open holes, design 88, three members, $1,200 operating profit | $4,200 |
| Pine Ridge | Mountain golf and staffing | Four open holes, two staff, 30 rounds, $1,600 operating profit | $6,000 |
| Prairie Run | Community course expansion | Five open holes, two finished events, six members, $2,500 operating profit | $8,500 |
| The Oasis | Desert resort | Six open holes, design 90, ten members, $4,000 operating profit | $12,000 |

Each objective has a one-time cash reward. Claim it from **Journey**. Complete all four objectives to unlock travel. Moving is optional and confirmed: medals, portfolio completions and career stats persist; the old property’s terrain, cash, local members, staff and operating history are retired. There is no revisit mode in this version. Later properties have authored hole routings, names and hazards, with region-specific conditions.

## New ways to build and play

- **Design mode:** pause while planning and editing. Construction still costs money. Edited holes close and must be reopened.
- **Design report:** forgiveness, scenery, strategy and character. Trees beside a hole improve scenery; trees in the playing line hurt forgiveness. Too much water can make a hole punishing. Ratings affect enjoyment after completed holes, weighted by golfer skill. This is a readable design heuristic, not a replacement for actual score data.
- **Doglegs:** set a routing waypoint, then paint a fairway along the new line. Moving the waypoint costs $40 before regional multipliers, and can be undone.
- **Green shaping:** paint additional putting surface for $24/tile before regional multipliers. Tee boxes and paths remain protected.
- **Cart paths:** $8/tile before regional multipliers. Golfers walk 30% faster while on paths; the pathfinding system favors paths.
- **Shot landings:** show the selected hole’s last sampled landing marks. Gold marks are normal outcomes; coral marks indicate water, trees, or out-of-bounds. At most 400 recent course-wide shots are retained.
- **One-action green repair:** Course provides a priced repair proposal for the selected green, with confirmation.
- **Owner practice:** Course → Play this hole / Play course. Tap the map to aim, select driver/iron/wedge/putter, then hit. Shot range depends on lie and region. Aim-at-pin assists on small screens. Ball flight, putting, penalties, stroke limits, and saved scorecards are included. Practice pauses guests and has no cash rewards or wear; it uses its own random stream.
- **Camera:** overview, selected-hole focus, zoom, clickable minimap, and follow buttons in Guests.

## Guests and club management

Delighted guests who complete at least two holes can become named members. Members return and pay $8/day plus $3 per clubhouse level; unhappy members leave. The host lowers the satisfaction threshold to join. Member names are retained rather than inventing a fresh visitor identity on each return.

Staff are in **Club**:

| Specialist | Hiring fee | Daily wage | Effect |
| --- | --- | --- | --- |
| Head greenkeeper | $180 | $72 | Restores 2 turf condition per simulated hour, up to the crew ceiling |
| Course ranger | $160 | $48 | Tee intervals 25% shorter; reduces wait-related frustration |
| Club host | $140 | $42 | +4 guest satisfaction; easier member recruitment |

The existing upgrades, clubhouse levels, tee-time prices, regional seasons, events, land purchases, goals and golfer simulation remain available. Staff wages are posted hourly to maintenance, so operating profit includes them.

## Persistence and phone use

- Existing version-2 local saves remain compatible. New campaign, staff, members and scorecard fields default safely when absent.
- Live golfers, their tee queues, and active events now resume after short reloads. Simplified offline-day income replaces stale actors after a longer absence.
- Menu includes save backup export/import. Import replaces the current device’s save after confirmation. It does not provide automatic cloud sync.
- The production build precaches its hashed JavaScript/CSS and icons, allowing offline reload after its first successful installation. Development mode does not install the production service worker.
- Saves are local to the browser/origin or native container. Browser and future native-app saves do not automatically sync.

## Validation

Automated tests cover the original simulation/economy as well as campaign gating, one-time rewards, all five transitions, distinct playable regional routings, staff wages, design consequences, editable greens, dogleg undo/refunds, practice shots, scorecards, member dues, older save migration and resuming live guests/events.

Browser checks exercise phone-sized onboarding/navigation, owner shots, and desktop rendering. The built website is also tested at a repository-style subpath and reloaded with networking disabled.

## iOS development status

The existing Capacitor configuration is retained. The source remains a small TypeScript canvas/web project suitable for wrapping in the native shell. No signed iOS build or native Xcode project is included, and this update has not been tested on physical iOS hardware or WebKit.

For an eventual paid release, the next work is physical-device performance and touch testing, further playtesting of objective pacing and prices, an art/animation/audio pass, save recovery testing, and native packaging. The current owner round uses club/aim controls, not a timing-based swing meter. The campaign supports five locations and retires completed properties rather than simulating an unlimited portfolio.

---

## Original prototype reference


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
