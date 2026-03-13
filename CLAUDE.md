# Powerhouse — 12-Week Training App

## Project Overview
A fitness tracking web app called **Powerhouse** built as a single `index.html` file. Dark-themed, monospace font, mobile-first design (max-width 480px).

## Current State
- Single-file app: `index.html` (HTML + CSS + vanilla JS, no frameworks)
- All data stored in `localStorage`
- No build tools, no dependencies, no backend

## Features
- **4 tabs**: Home, Workout, Food, Water (bottom nav)
- **Home**: Day streak, summary cards (exercises done, calories, water), nutrition/hydration progress bars
- **Workout**: 12-week program with 3-day and 5-day split options, 3 phases (Phase 1: weeks 1-4, Phase 2: 5-8, Phase 3: 9-12), exercise checklist per day
- **Food**: Meal logging (name, calories, protein), daily totals with progress bars, meal list with delete
- **Water**: Circular progress ring, quick-add buttons (+8oz, +16oz, +32oz), reset button
- **Settings**: Name, calorie target, protein target, water target, current week (1-12), program split (3 or 5 day)

## Design System
- Colors: `--bg:#0D0D0D`, `--red:#E74C3C` (Phase 1), `--orange:#E67E22` (Phase 2), `--green:#27AE60` (Phase 3), `--blue:#3B82F6` (water)
- Phase color is used as the accent color throughout the app
- Cards with 14px border radius, dark card backgrounds (#111)
- Monospace font stack: SF Mono, JetBrains Mono, Fira Code, Consolas

## localStorage Keys
- `ph_settings` — user settings object
- `ph_workout_YYYY-MM-DD` — exercise completion data per date
- `ph_meals_YYYY-MM-DD` — array of meal objects per date
- `ph_water_YYYY-MM-DD` — water intake in oz per date

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
