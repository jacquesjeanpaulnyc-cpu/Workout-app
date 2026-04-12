# Powerhouse — 12-Week Training App

## Project Overview
A fitness tracking web app called **Powerhouse** built as a single `index.html` file. Dark-themed, monospace font, mobile-first design (max-width 480px). User is an expert athlete with 15+ years of experience.

## Current State
- Single-file app: `index.html` (HTML + CSS + vanilla JS, no frameworks)
- All data stored in `localStorage`
- No build tools, no dependencies, no backend

## Features
- **5 tabs**: Home, Workout, Food, Water, Steps (bottom nav)
- **Home**: Day streak, **morning routine checklist** (jump rope 10 min, push-ups 4×25, pull-ups max reps, ab roller 4×15), **75 Hard daily discipline** (read 10 pages + transformation photo capture), summary cards (exercises done, calories, water in litres, steps with progress bar), nutrition/hydration progress bars
- **Workout**: 12-week program with 3-day and 5-day split options, 3 phases (Phase 1: weeks 1-4, Phase 2: 5-8, Phase 3: 9-12), exercise checklist per day
- **Food**: **Intermittent fasting tracker** (16:8 and 24hr fast options, live timer with progress ring, eating/fasting window status, Monday reminder for weekly 24hr fast), meal logging (name, calories, protein), daily totals with progress bars, meal list with delete
- **Water**: Circular progress ring (properly centered, no overlap), quick-add buttons (+0.25L, +0.5L, +1L), all units in **Litres**, reset button
- **Steps**: **Daily step tracking** with circular progress ring, quick-add buttons (+500, +1K, +2.5K), custom entry, **Walk Tool** (start/stop timer with auto step estimation at ~100 steps/min), **weekly bar chart** (Sun-Sat with average line), walk session log with delete, step progress bar
- **Settings**: Name, calorie target, protein target, water target (in L), step target (default 10,000), current week (1-12), program split (3 or 5 day)

## Design System
- Colors: `--bg:#0D0D0D`, `--red:#E74C3C` (Phase 1), `--orange:#E67E22` (Phase 2), `--green:#27AE60` (Phase 3), `--blue:#3B82F6` (water), `--purple:#9B59B6` (75 Hard), `--teal:#2DD4BF` (steps)
- Phase color is used as the accent color throughout the app
- Cards with 14px border radius, dark card backgrounds (#111)
- Monospace font stack: SF Mono, JetBrains Mono, Fira Code, Consolas

## localStorage Keys
- `ph_settings` — user settings object (includes waterTarget in litres, stepTarget, fastStartHour)
- `ph_workout_YYYY-MM-DD` — exercise completion data per date
- `ph_meals_YYYY-MM-DD` — array of meal objects per date
- `ph_water_YYYY-MM-DD` — water intake in litres (float) per date
- `ph_morning_YYYY-MM-DD` — morning routine exercise completion per date
- `ph_fasting` — current fasting session {active, startTime, duration, type}
- `ph_daily_YYYY-MM-DD` — daily discipline data {reading: bool, photo: base64 string}
- `ph_steps_YYYY-MM-DD` — step count (integer) per date
- `ph_walks_YYYY-MM-DD` — array of walk session objects [{startTime, endTime, duration, steps}]
- `ph_walk_active` — current active walk session {active, startTime}

## Next Steps (Planned)
- **Convert to PWA** (Progressive Web App) so it can be installed on phone for free
  - Add a `manifest.json` (app name, icons, theme color, display: standalone)
  - Add a `service-worker.js` for offline caching
  - Add install prompt / "Add to Home Screen" support
  - Generate app icons (multiple sizes)
  - This was discussed and planned for the next session

## Git
- Repo: `jacquesjeanpaulnyc-cpu/Workout-app`
- Development branch: `claude/build-powerhouse-app-ghEzV`
