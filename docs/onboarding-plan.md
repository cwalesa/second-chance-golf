# Little Links: onboarding rework

## Every player-facing system and screen (found by reading the code)

**Screens**
- Start screen: region picker (5 regions), club name, crest designer, tutorial toggle.
- Map (canvas): pan, pinch, tap-to-inspect, hole routing line, golfers, heatmap of shot landings.
- Status chip (header): menu/brand, LVL badge, cash, day + clock + day bar, fee stepper, rating, guests, today's profit, event, golfers on course, speed buttons.
- Round menu button, which opens the nav sheet: speed row, Design, Course, Golfers, Finances, Clubhouse, Goals, map shortcuts, "Settings and save".
- Design tray: Select/Pan; Terrain (fairway, green, rough, path, bunker, water); Nature (plant/clear tree, repair); Holes (move tee, move cup, dogleg, new hole); Decorate (7 items); Buildings (halfway house, cart barn, maintenance shed, buy cart); Undo; brush size.
- Placement bars: clubhouse (Suggest / Build here), new hole (par, +Bend, Straight, Build/Cancel), building ghost, paint proposal.
- "Next job" goal bar; preview pill; toasts with Undo; first-use tool tips and panel tips.
- Course panel: hole stats, par, open/close, Play it (out of scope), Test golfers, edit hole actions, hole list, test results, design report, turf and repair, guest results, tile inspector, practice scorecards.
- Golfers panel: satisfaction breakdown, "why", selected golfer, members, watch a golfer, comments.
- Finances: tee-time pricing bands, today's ledger, last day summary, improvements (amenities, carts, fleet, cart price), recent transactions.
- Events panel (reachable only from a goal today), Clubhouse panel (crest, upgrade, rating, region/seasons, staff, career), Goals panel (streak, daily challenges, goal chain).
- Modals: rename, logo, settings (music, sound, haptics, daily reports), save/export/import, reset, day report, repair green; celebration popups (goal, level, ace, streak).

**Systems**: building and editing holes, par and length advice, bends, terrain painting, trees, repair; buildings (halfway house, cart barn, shed) and decor; cart paths and bridges; opening holes and validation; test golfers; fees by tee-time band; maintenance/upkeep; day cycle, recap, offline earnings; turf wear and condition; guest satisfaction, comments, members; course rating (stars); clubhouse upgrades; staff; improvements, carts and fleet; events and bookings; seasons; goals chain, daily challenges and streak, level/XP/career; save, export, import.

**Findings that shape the work**
- Four progress systems: the goal chain (visible and real); milestones in goals.ts (28 entries, never evaluated or shown, so dead code, and the land ones are broken); the `GOALS` objectives (only used by a recap suggestion); daily challenges and streak (real). Plus an XP "LVL" badge whose level-ups have no visible meaning (the projects UI that uses career XP is not rendered).
- There is no rain or weather in the game. "First rainy day" cannot be built; seasons can.
- Events has no menu entry. The Goals chain reaches it with a hidden tab.
- The tutorial runs on a separate practice course (cash $60,000, clubhouse pre-built); the real course then starts at $25,000 with a clubhouse step the tutorial never taught.

## Decisions

1. **Tutorial runs on the real course.** Start screen, then clubhouse, then hole. Cash is $25,000 everywhere (the start screen already says so). Tutorial actions are charged at normal prices (a par 3 is about $2,400, a bunker about $150), and Undo refunds, so the numbers the player sees are the real ones.
2. **Forced tutorial = 10 steps**: clubhouse, par, tee, green, build, bunker (skippable), open, watch, fee (open Finances, change one fee), start. Everything else moves to introductions.
3. **Replay** from Settings re-runs the tutorial on the current course (the clubhouse step is skipped when one exists). It builds one more hole at normal prices.
4. **One progression**: the Goals chain is the spine ("Next goal"). Dead milestones and the invisible LVL badge are removed. Daily challenges and the streak stay as the return hook, shown from the second real-world day.
5. **Reason to come back tomorrow**: a "While you were away" course report (rounds, money, a guest comment about a named hole, one suggested fix) that opens the day's challenges.
6. **Intros engine** (`src/intros.ts`): data-driven, one at a time, cooldown on real play time, never during placement/painting/confirmation/modals/tutorial, dismiss in one tap and never again, listed in a Guide in the menu, switchable off in Settings.
7. **Landscape**: the tool tray becomes a right-hand side rail; the build bar moves to the side away from the hole (or the camera pans the preview into view); the coach docks clear of the side panel header; the start screen uses its left column.
8. **Old saves**: new tutorial progress is stored by step id. Old practice saves (and parked saves) load and are converted. Test added.

## Final order of introductions and their triggers

All wait for the tutorial to be finished, and for the player to be idle. First one waits 2 minutes after the tutorial (the Goals line, 6 seconds); every other one waits 4 minutes of play after the last.

| # | id | trigger |
|---|----|---------|
| 1 | goals | right after the tutorial (replaces a celebration for the first goal) |
| 2 | bends | New hole tool picked while only one hole exists; the +Bend button is ringed once the green is placed |
| 3 | shaping | two holes built |
| 4 | bands | first full day ended |
| 5 | upkeep | a day ended at a loss |
| 6 | turf | an open hole's green or turf is worn |
| 7 | golfers | 5 rounds played, or a poorly rated round |
| 8 | stars | a star earned, or half a star with 3 open holes |
| 9 | b-shed | 4 open holes |
| 10 | b-halfway | 6 open holes |
| 11 | paths | a building has been placed |
| 12 | b-barn | 8 open holes (or carts and 5 holes) |
| 13 | fleet | a cart barn is built |
| 14 | amenities | an improvement is affordable ($1,500, none owned, 2 open holes) |
| 15 | staff | 5 open holes |
| 16 | clubup | first clubhouse upgrade available |
| 17 | members | first member joins |
| 18 | events | first event bookable |
| 19 | seasons | first season change (day 5) |
| 20 | daily | the daily challenges arrive (second real day) |
| - | recap | shown inside the first end-of-day recap, not as a card |

List order is priority; the engine shows the first eligible one.

## Still to flag

- **No rain exists in the game**, so "first rainy day" has no trigger. Seasons are covered.
- The XP/career system is kept (it still gives construction discounts) but is now invisible: no badge, no level-up pop-ups. The projects panel that spent career XP is not rendered by the current UI.
- "Replay the tutorial" builds one more hole on the current course at normal prices (it needs a free hole slot and about $3,500).
- Old tool tips and panel tips remain, now behind the same gate (45 second rest, off with the setting).
- The CSS has many layered overrides; the new rules live in `src/guide.css`, loaded last. The older rules were left alone.
- Safe-area insets use `env()` in the new landscape rules; Playwright reports zero insets, so notch spacing was reviewed in the CSS, not on a device.
- Cooldown values (240 s, first 120 s, tips 45 s) are untuned guesses. Playtest and adjust `COOLDOWN`, `FIRST_WAIT`, `TIP_COOLDOWN` in `src/intros.ts`.
