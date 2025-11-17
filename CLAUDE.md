# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Tesla Cloud is a JavaScript+PHP web application optimized for Tesla's in-car browser. It provides news aggregation, weather data, navigation links, and stock tickers through a responsive touch-friendly interface. The application uses ES6 modules on the frontend, PHP 8.2+ for backend APIs, and SQLite/MySQL for data persistence.

## Development Commands

### Starting the Development Server
```bash
php -S localhost:8000
```
- Serves at http://localhost:8000
- Creates temporary SQLite database in `/tmp/` automatically
- No build process required - edit files directly and refresh browser
- Restart server only when changing PHP files

### Running Tests
```bash
# REST API tests (1.5s runtime)
./test/restdb.sh

# Environment configuration tests (0.5s runtime)
cd test && DOTENV_PATH="$(pwd)/../php/dotenv.php" bash dotenv.sh

# Settings polling tests
./test/settings_polling.sh

# PHP syntax check
php -l php/*.php
```

### News Feed Management (Python Scripts)
```bash
# Manual feed update (normally run by cron)
python3 news/update_news.py

# Initialize database tables
python3 news/init_db.py

# Fetch specific feeds
python3 news/fetch_feeds.py nyt wsj techcrunch

# Clean up old articles
python3 news/cleanup_db.py
```

**Cron Setup:** News feeds are fetched on a schedule (typically every 5-15 minutes):
```cron
*/5 * * * * cd /path/to/tesla-cloud && python3 news/update_news.py >> /var/log/news_update.log 2>&1
```

## Architecture

### Frontend Architecture (ES6 Modules)
- **Entry Point:** `index.html` bootstraps the SPA
- **Core Module:** `js/app.js` - orchestrates navigation, GPS, and state management
- **Shared Utilities:** `js/common.js` - test mode detection, notifications, timezone handling
- **Feature Modules:** Each section has its own module:
  - `js/news.js` - News aggregation with IntersectionObserver for lazy loading
  - `js/wx.js` - Weather radar, forecasts, precipitation graphs
  - `js/stock.js` - Stock ticker updates
  - `js/net.js` - Network diagnostics and ping tests
  - `js/settings.js` - User authentication, preferences, driving state
  - `js/location.js` - GPS simulation for testing

### Backend Architecture (PHP)
- **REST Database:** `php/rest_db.php` - RESTful key-value store using SQLite/MySQL
- **News API:** `php/news.php` - Queries database populated by Python scripts, serves JSON to frontend
- **Configuration:** `php/dotenv.php` - Loads `.env` file, provides database connections
- **Endpoints:** Simple PHP files in `php/` directory (e.g., `vers.php`, `settings.php`, `quote.php`)

### News Backend System (Python)
The news system uses a two-tier architecture:

1. **Backend Tier (Python):** Cron-scheduled scripts fetch RSS feeds and populate database
   - `news/update_news.py` - Main cron entry point
   - `news/fetch_feeds.py` - RSS parser and article extractor
   - `news/cleanup_db.py` - Removes old articles based on feed `lifetime` settings
   - `news/init_db.py` - Database schema initialization

2. **API Tier (PHP):** `php/news.php` queries pre-populated database and serves JSON
   - Frontend (`js/news.js`) remains unchanged from previous architecture
   - No on-demand RSS fetching - all data comes from database

**Database Schema:**
- `news_articles`: Stores articles (feed_id, url, title, published_date, created_at)
- `feed_updates`: Tracks last update times and counts per feed

### Data Flow
1. User navigates sections via `app.js` which manages state and coordinates modules
2. Each module fetches data from PHP APIs (e.g., `php/news.php`, `php/quote.php`)
3. PHP endpoints query SQLite/MySQL databases or external APIs
4. For news: Python scripts pre-populate database on schedule, PHP serves cached data
5. Frontend updates DOM using vanilla JavaScript and Chart.js for visualizations

### Configuration System
- **Feed Config:** `config/news.json` - RSS feeds with `refresh` (update frequency in minutes), `lifetime` (retention in days), category
- **Stock Config:** `config/stocks.json` - Stock symbols and index definitions
- **Environment:** `.env` - API keys, database credentials (JSON format, not dotenv standard)
- **Database:** Supports both SQLite (default) and MySQL via `.env` settings

### Key Design Patterns
- **Module Isolation:** Each feature in separate ES6 module with explicit imports/exports
- **Progressive Enhancement:** Graceful degradation when external APIs fail (shows "--" for missing data)
- **Test Mode Detection:** `isTestMode()` checks for localhost/dev environments
- **Lazy Loading:** News uses IntersectionObserver to load articles on scroll
- **State Management:** Settings stored in database via REST API, cached in localStorage

## Development Workflow

### Making Changes
1. Run tests first to establish baseline
2. Start dev server: `php -S localhost:8000`
3. Edit files directly (no build step)
4. Refresh browser for frontend changes
5. Restart PHP server for backend changes
6. Verify tests still pass

### Testing Without External APIs
The application degrades gracefully without API keys:
- News feeds may be empty (needs database population)
- Stock prices show "--" (needs external financial APIs)
- Weather may not load (needs API keys in `.env`)
- Focus on UI/UX and core functionality during development

### Common Issues
- **DotEnv test fails:** Use absolute path - `cd test && DOTENV_PATH="$(pwd)/../php/dotenv.php" bash dotenv.sh`
- **Port 8000 in use:** Kill existing server - `pkill -f "php -S localhost:8000"`
- **News database empty:** Run `python3 news/update_news.py` or check cron job
- **Chart.js errors:** Normal if external CDN blocked, core functionality unaffected

## Code Style

### JavaScript
- ES6 modules with explicit imports/exports
- `const`/`let` (no `var`)
- 4-space indentation
- lowerCamelCase for functions, PascalCase for classes, SCREAMING_SNAKE_CASE for constants
- Shared config constants in `common.js`

### PHP
- PSR-12 style spacing and indentation
- DocBlocks on functions (see `php/dotenv.php` as reference)
- snake_case for filenames (matches route names)
- Consistent error logging to `/tmp/` files

### JSON
- Lowercase keys
- Sorted lists where applicable
- Pretty-printed for readability

## Security Considerations
- Never commit real credentials - use redacted `.env` entries or `test/test_envs/` fixtures
- New secrets must flow through `php/dotenv.php`
- Frontend should degrade cleanly via `isTestMode` when data is absent
- Scrub logs before sharing (see `SECURITY.md`)
- Keep local overrides in ignored paths like `config/`

## Python Dependencies

News scripts use **only standard library** (no pip packages required):
- `json`, `sqlite3`, `urllib`, `xml.etree.ElementTree`, `datetime`, `pathlib`, `os`, `sys`

**Optional:** For MySQL support: `pip install pymysql`

## Testing Philosophy
- System tests use `curl`, `sqlite3`, and PHP built-in server
- Run focused script for module you're editing
- Run full test suite before requesting review: `./test/restdb.sh && cd test && DOTENV_PATH="$(pwd)/../php/dotenv.php" bash dotenv.sh`
- Manual UI verification required for visual changes (browser + viewport testing)
- Note any manual testing steps in PR descriptions

## File Organization
- `index.html` - SPA entry point
- `js/` - Frontend ES6 modules
- `php/` - Backend APIs and utilities
- `css/` - Stylesheets
- `config/` - JSON configuration files
- `news/` - Python RSS fetching scripts
- `test/` - Shell test scripts
- `assets/` - Static media
- `.devcontainer/` - VS Code dev container (PHP 8.2, Node 20)
