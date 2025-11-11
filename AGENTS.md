# Repository Guidelines

## Project Structure & Module Organization
`index.html` bootstraps the dashboard and wires the ES modules under `js/`, with `app.js` orchestrating state, `common.js` hosting utilities, and feature modules (`wx.js`, `news.js`, `stock.js`) scoped to their panes. Styles live in `css/`, static media in `assets/`, PHP APIs plus helpers in `php/` (all configured via the JSON `.env`), curated datasets in `json/`, and automation resources plus shell tests in `test/`.

## Build, Test, and Development Commands
- `php -S localhost:8000 -t .` — serves the SPA and PHP endpoints; use while refining any front-end or API change.
- `bash test/dotenv.sh` — exercises `php/dotenv.php`; rerun after touching env parsing or `.env`.
- `bash test/restdb.sh` — runs PUT/GET/DELETE flows against `php/rest_db.php`; accepts `BASE_URL=...` if another server is listening.
- `bash test/settings_polling.sh` — checks live settings polling and requires `curl` plus the dev server.
Spot-check PHP syntax with `php -l php/*.php` before pushing.

## Coding Style & Naming Conventions
JavaScript code sticks to ES Modules, `const`/`let`, and 4-space indentation; keep functions lowerCamelCase and exported classes PascalCase, with shared config constants in SCREAMING_SNAKE_CASE. PHP follows PSR-12-style spacing and DocBlocks (`php/dotenv.php` is the reference) and endpoint filenames stay snake_case to mirror their routes; JSON keys remain lowercase and lists sorted.

## Testing Guidelines
System tests rely on `curl`, `sqlite3`, and the PHP built-in server; install those locally before iterating. Run the focused script tied to whatever PHP or data module you edit, and rerun the full trio before requesting review. Mirror the descriptive naming already used in `test/*.sh`, and note any manual UI verification (browser + viewport) inside the PR when automation does not apply.

## Commit & Pull Request Guidelines
Commit subjects match history: short, imperative lines with optional issue suffixes such as `(#326)` when closing tickets. Open PRs with a crisp summary, highlight key files, add screenshots for UI work, and list the commands you ran; keep drafts open for feedback but mark Ready only after linting and tests complete.

## Security & Configuration Tips
Do not commit working credentials—use redacted `.env` entries or the fixtures under `test/test_envs/`. New secrets must flow through `php/dotenv.php`, and JS should degrade cleanly via `isTestMode` when data is absent. Re-read `SECURITY.md` for telemetry-sensitive edits, scrub logs before sharing, and keep any local overrides inside ignored paths such as `config/`.
