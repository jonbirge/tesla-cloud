# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Tesla Cloud is a JavaScript+PHP web application designed for Tesla's in-car browser. It provides news, weather, navigation, market data, and other features optimized for vehicle touchscreen use.

## Development Commands

### Start Development Server
```bash
php -S localhost:8000
```
Serves the application at http://localhost:8000. Creates a local SQLite database in `/tmp/` for testing.

### Run Tests
```bash
# API tests (REST database endpoints)
./test/restdb.sh

# Environment configuration tests
cd test && DOTENV_PATH="$(pwd)/../php/dotenv.php" bash dotenv.sh

# Run all tests
./test/restdb.sh && cd test && DOTENV_PATH="$(pwd)/../php/dotenv.php" bash dotenv.sh
```

### Quick API Verification
```bash
curl -s http://localhost:8000/php/vers.php
```

## Architecture

### Frontend (ES6 Modules)
- `index.html` - Single-page application entry point with section-based navigation
- `js/app.js` - Main application logic, GPS tracking, section switching, coordinates-based data fetching
- `js/settings.js` - User authentication, settings management, driving state detection
- `js/common.js` - Shared utilities and exports (notification system, debug mode, GPS state)
- `js/wx.js` - Weather data fetching and display (premium weather API, satellite imagery)
- `js/news.js` - News aggregation with live updates and RSS feed processing
- `js/market.js` - Market section with stock indices display
- `js/stock.js` - Individual stock ticker updates
- `js/net.js` - Network diagnostics, ping testing, IP-based geolocation
- `js/location.js` - Position simulation for testing

### Backend (PHP 8.2+)
- `php/rest_db.php` - REST API for data storage (SQLite locally, MySQL/MariaDB in production)
- `php/settings.php` - User settings CRUD operations
- `php/news.php` - News aggregation from RSS feeds
- `php/openwx.php` - Weather API proxy
- `php/dotenv.php` - Environment configuration loader

### CSS Architecture
- `css/styles.css` - Main styles with CSS variables for theming (light/dark mode)
- Feature-specific stylesheets: `wx.css`, `news.css`, `market.css`, `settings.css`, `timeline.css`, `notify.css`
- Mobile breakpoint: `@media only screen and (max-width: 900px)`
- Font scale variables: `--font-xs` (11pt) through `--font-xl` (19pt)

### Configuration
- `config/` - JSON configuration files for news feeds, stock symbols, market indices
- `.env` - API keys and database credentials (not in repo)

## Key Patterns

- **Section-based UI**: Navigation via `showSection()` function; sections can be marked `no-driving` to disable while moving
- **GPS-driven updates**: Weather, landmarks, and other data refresh based on location changes with configurable distance/time thresholds
- **Dual database support**: SQLite for local development, MySQL/MariaDB for production (auto-detected via `.env`)
- **No build process**: Edit files directly; refresh browser for frontend changes, restart PHP server for backend changes

## Working Without External APIs

Many features require external API keys configured in `.env`. Without them:
- Stock prices show "--"
- Weather may not load
- News feeds may be empty

Focus on core functionality and UI/UX rather than external API integration during development.

## Git Workflow

- **Never commit changes on your own.** Wait for explicit instructions from the user before committing to the repository.
