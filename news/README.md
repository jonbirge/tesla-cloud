# News Backend System

This directory contains Python scripts for fetching and storing news articles from RSS feeds into a database.

## Overview

The news backend system replaces the on-demand PHP RSS fetching with a scheduled Python-based approach that:
- Fetches RSS feeds on a regular schedule (via cron)
- Stores articles in a database (SQLite or MySQL)
- Allows the PHP frontend to query pre-fetched articles efficiently

## Files

### `db_config.py`
Database configuration module that:
- Reads configuration from `../.env` file
- Supports both MySQL and SQLite databases
- Defaults to SQLite at `/tmp/news.db` if no config is found

### `db_init.py`
Database initialization script that:
- Creates the `news_articles` table (feed_name, url, title, published_date)
- Creates the `feed_updates` table (feed_name, last_updated)
- Creates indices for better query performance
- Can be run standalone: `python3 db_init.py`

### `fetch_feeds.py`
RSS feed fetching and parsing module that:
- Fetches RSS/Atom feeds from URLs
- Parses multiple date formats
- Handles both RSS and Atom feed structures
- Extracts article title, URL, and publication date

### `update_news.py` (Main Script)
The main update script that handles everything:
- Checks if database exists and initializes it if needed
- Reads feed configuration from `../json/news-feeds.json`
- Determines which feeds need updating based on cache time
- Fetches and stores new articles
- Cleans up old articles (older than 7 days)
- Can be run with `--force` flag to update all feeds immediately

## Database Schema

### `news_articles` table
```sql
- id: Primary key
- feed_name: Feed identifier (e.g., 'nyt', 'bbc')
- url: Article URL
- title: Article title
- published_date: Unix timestamp of publication
- created_at: When the article was added to database
- UNIQUE constraint on (feed_name, url)
```

### `feed_updates` table
```sql
- feed_name: Primary key, feed identifier
- last_updated: Unix timestamp of last fetch
- updated_at: When the record was last updated
```

## Usage

### Running the update script manually
```bash
# Update feeds that are due for refresh (based on cache time)
python3 update_news.py

# Force update all feeds immediately
python3 update_news.py --force
```

### Setting up cron
Add to crontab to run every 5 minutes:
```cron
*/5 * * * * cd /path/to/tesla-cloud/news && python3 update_news.py
```

### Database Configuration
Create a `.env` file in the parent directory with:
```env
# For MySQL/MariaDB
SQL_HOST=your-mysql-host
SQL_USER=your-username
SQL_PASS=your-password
SQL_DB_NAME=your-database

# For SQLite (optional, defaults to /tmp/news.db)
SQLITE_PATH=/path/to/database.db
```

If no `.env` file exists or `SQL_HOST` is not set, the system defaults to SQLite.

## Requirements

- Python 3.6+
- Standard library modules (no external dependencies for SQLite)
- `mysql-connector-python` package if using MySQL (install: `pip install mysql-connector-python`)

## Integration with PHP Frontend

The PHP script `php/news.php` has been updated to:
- Query the database instead of fetching RSS feeds
- Use the same database configuration from `.env`
- Maintain the same API interface for the frontend JavaScript
- Filter articles by feed name and age
- Return articles in the same JSON format

## Notes

- Articles are automatically cleaned up after 7 days
- Duplicate articles (same feed + URL) are ignored
- Failed feed fetches don't update the timestamp, so they'll be retried on the next run
- The system respects the `cache` time configured in `news-feeds.json`
