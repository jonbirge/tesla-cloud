# News Backend Scripts

This directory contains Python scripts for fetching and managing news articles in the backend database.

## Overview

These scripts replace the on-demand RSS feed fetching that was previously done by PHP. Instead, news feeds are now fetched on a scheduled basis by a cron job, stored in a database, and served to clients via PHP queries.

## Architecture

- **Python scripts** (in this directory) handle RSS feed fetching and database management
- **SQLite/MySQL database** stores articles and feed update timestamps
- **PHP endpoint** (`php/news.php`) queries the database and serves JSON to the frontend
- **JavaScript frontend** (`js/news.js`) remains unchanged

## Scripts

### `update_news.py` - Main Update Script (Cron Entry Point)

The primary script that should be run by cron. It:
- Checks and initializes the database if needed
- Determines which feeds need updating based on cache times
- Fetches feeds that are due for update
- Cleans up old articles based on feed lifetimes

**Usage:**
```bash
python3 update_news.py
```

**Cron Example (run every 5 minutes):**
```cron
*/5 * * * * cd /path/to/tesla-cloud && python3 news/update_news.py >> /var/log/news_update.log 2>&1
```

### `init_db.py` - Database Initialization

Creates the required database tables:
- `news_articles` - Stores feed articles (feed_id, url, title, published_date)
- `feed_updates` - Tracks last update times for each feed

**Usage:**
```bash
python3 init_db.py
```

Note: This is automatically called by `update_news.py` if tables don't exist.

### `fetch_feeds.py` - Feed Fetcher

Fetches RSS feeds and stores articles in the database. Can fetch specific feeds or all feeds.

**Usage:**
```bash
# Fetch all feeds
python3 fetch_feeds.py

# Fetch specific feeds
python3 fetch_feeds.py nyt techcrunch wsj
```

### `cleanup_db.py` - Database Cleanup

Removes old articles from the database based on feed lifetime configuration.

**Usage:**
```bash
# Clean up based on feed lifetime settings in config/news.json
python3 cleanup_db.py

# Clean up all articles older than N days
python3 cleanup_db.py 7
```

Note: This is automatically called by `update_news.py` during each update.

## Configuration

### Feed Configuration (`config/news.json`)

Each feed has the following properties:
- `id`: Unique feed identifier
- `name`: Display name
- `url`: RSS feed URL
- `cache`: Update frequency in minutes (how often to fetch)
- `lifetime` (optional): Article retention in days. Omit or set to `0` to keep articles indefinitely.
- `category`: Feed category
- `defaultEnabled`: Whether enabled by default for new users
- `icon`: (optional) Feed icon URL

**Example:**
```json
{
  "id": "nyt",
  "name": "New York Times",
  "url": "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml",
  "cache": 5,
  "lifetime": 0,
  "category": "general",
  "defaultEnabled": true
}
```

### Database Configuration (`.env` file)

The scripts support both SQLite (default) and MySQL/MariaDB via environment variables:

**SQLite (default):**
```bash
# Optional: specify custom SQLite path
SQLITE_PATH=/custom/path/news_articles.db
```

**MySQL:**
```bash
SQL_HOST=mysql.example.com
SQL_USER=username
SQL_PASS=password
SQL_DB_NAME=tesla_cloud
```

If no `.env` file is present or no database settings are configured, the scripts will use SQLite with the database file at `../news_articles.db`.

## Database Schema

### news_articles
- `id`: Auto-increment primary key
- `feed_id`: Feed identifier (from config)
- `url`: Article URL (unique per feed)
- `title`: Article title
- `published_date`: Article publication date
- `created_at`: Record creation timestamp

### feed_updates
- `feed_id`: Feed identifier (primary key)
- `last_updated`: Last successful update timestamp
- `last_check`: Last check timestamp
- `update_count`: Number of times feed has been updated

## Python Package Requirements

All scripts use only Python standard library modules:
- `json` - JSON parsing
- `sqlite3` - SQLite database access
- `urllib` - HTTP requests
- `xml.etree.ElementTree` - XML/RSS parsing
- `datetime` - Date/time handling
- `pathlib` - Path manipulation
- `os`, `sys` - System operations

**Optional:** For MySQL support, install:
```bash
pip install pymysql
```

## Workflow

1. **Cron runs `update_news.py` every 5-15 minutes**
2. Script checks which feeds need updating based on:
   - Feed's `cache` setting (update frequency)
   - Time since last update (from `feed_updates` table)
3. Fetches RSS feeds for feeds that need updating
4. Parses RSS/Atom XML and extracts articles
5. Stores new articles in database (or updates existing ones)
6. Updates feed timestamps in `feed_updates` table
7. Cleans up articles for feeds that have a finite `lifetime` setting
8. **PHP endpoint queries database when clients request news**
9. Frontend receives fresh news from database (not directly from RSS)

## Benefits of Backend Fetching

- **Performance**: Clients don't wait for RSS feed downloads
- **Reliability**: Database survives temporary feed outages
- **Efficiency**: Feeds fetched once, served to many clients
- **Control**: Centralized article retention and cleanup
- **Scalability**: Database can be moved to dedicated SQL server

## Migration Notes

The old PHP script that fetched feeds on-demand has been replaced. The new PHP script maintains the same JSON API interface, so the frontend JavaScript requires no changes. The only difference is that news is now served from the database instead of being fetched on demand.
