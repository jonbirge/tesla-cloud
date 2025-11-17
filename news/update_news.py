#!/usr/bin/env python3
"""
Main update script for news feeds.
This is the entry point for cron jobs.
Handles initialization, fetching feeds that need updates, and cleanup.
"""

import os
import json
import sys
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
import importlib.util

from logging_utils import setup_dual_logging

setup_dual_logging()

SCRIPT_PATH = Path(__file__).resolve()
SCRIPT_DIR = SCRIPT_PATH.parent
PROJECT_ROOT = SCRIPT_DIR.parent

FORCE_SQLITE = True  # Set to True to use SQLite regardless of SQL_HOST settings


def load_module(module_path):
    """Dynamically load a Python module from file path."""
    spec = importlib.util.spec_from_file_location("module", module_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_env_file(env_path):
    """Load environment variables from .env file (JSON or KEY=VALUE)."""
    env_vars = {}
    if not os.path.exists(env_path):
        return env_vars
    
    with open(env_path, 'r') as f:
        content = f.read().strip()
    
    if not content:
        return env_vars
    
    # Try JSON first
    try:
        parsed = json.loads(content)
        if isinstance(parsed, dict):
            return {str(key): value for key, value in parsed.items()}
    except json.JSONDecodeError:
        pass
    
    # Fallback to KEY=VALUE parsing
    for line in content.splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            key, value = line.split('=', 1)
            env_vars[key.strip()] = value.strip().strip('"').strip("'")
    
    return env_vars


def resolve_sqlite_path(env_vars):
    """Resolve the filesystem path for the SQLite database."""
    return env_vars.get('SQLITE_PATH') or str(SCRIPT_DIR / 'news_articles.db')


def get_db_connection(env_vars):
    """
    Get database connection based on environment variables.
    Returns SQLite connection by default, MySQL if configured.
    """
    # Check for MySQL configuration unless forced to SQLite
    if not FORCE_SQLITE and env_vars.get('SQL_HOST'):
        # MySQL/MariaDB connection
        try:
            import pymysql
            connection = pymysql.connect(
                host=env_vars.get('SQL_HOST'),
                user=env_vars.get('SQL_USER'),
                password=env_vars.get('SQL_PASS'),
                database=env_vars.get('SQL_DB_NAME'),
                charset='utf8mb4',
                cursorclass=pymysql.cursors.DictCursor
            )
            return connection, 'mysql'
        except ImportError:
            print("ERROR: pymysql package required for MySQL connection")
            sys.exit(1)
        except Exception as e:
            print(f"ERROR: Failed to connect to MySQL: {e}")
            sys.exit(1)
    else:
        if FORCE_SQLITE:
            print("FORCE_SQLITE enabled - using SQLite database")
        # SQLite connection (default)
        db_path = resolve_sqlite_path(env_vars)
        connection = sqlite3.connect(db_path)
        connection.row_factory = sqlite3.Row
        return connection, 'sqlite'


def load_feed_config():
    """Load news feed configuration from JSON file."""
    config_path = PROJECT_ROOT / 'config' / 'news.json'
    
    with open(config_path, 'r') as f:
        config = json.load(f)
    
    return config.get('feeds', [])


def get_database_stats(connection, db_type):
    """Return total article count and oldest publish date."""
    cursor = connection.cursor()
    try:
        if db_type == 'mysql':
            cursor.execute("""
                SELECT COUNT(*) AS total, MIN(published_date) AS oldest
                FROM news_articles
            """)
            row = cursor.fetchone()
            total = row['total'] if row and row['total'] is not None else 0
            oldest = row['oldest'] if row else None
        else:
            cursor.execute("""
                SELECT COUNT(*), MIN(published_date)
                FROM news_articles
            """)
            row = cursor.fetchone()
            total = row[0] if row and row[0] is not None else 0
            oldest = row[1] if row else None
    except Exception:
        return {'total': 0, 'oldest': None}
    
    return {'total': total, 'oldest': oldest}


def compute_age_days(value):
    """Return age in days (rounded) for a datetime or ISO string."""
    if not value:
        return None
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value)
        except ValueError:
            return None
    if isinstance(value, datetime) and value.tzinfo is not None:
        # Normalize to UTC then drop tzinfo for comparison
        value = value.astimezone(timezone.utc).replace(tzinfo=None)
    try:
        delta = datetime.now() - value
        days = max(int(round(delta.total_seconds() / 86400)), 0)
        return days
    except Exception:
        return None


def get_database_size_mb(env_vars, db_type, connection):
    """Calculate approximate database size in megabytes."""
    size_bytes = 0
    if db_type == 'mysql':
        cursor = connection.cursor()
        cursor.execute("""
            SELECT SUM(data_length + index_length) AS size_bytes
            FROM information_schema.TABLES
            WHERE table_schema = DATABASE()
        """)
        row = cursor.fetchone()
        if row and row['size_bytes'] is not None:
            size_bytes = float(row['size_bytes'])
    else:
        db_path = resolve_sqlite_path(env_vars)
        if os.path.exists(db_path):
            size_bytes = os.path.getsize(db_path)
    
    size_mb = size_bytes / (1024 * 1024) if size_bytes else 0
    return round(size_mb, 2)


def check_and_init_database(env_vars):
    """Check if database tables exist, and initialize if needed."""
    print("Checking database tables...")
    
    try:
        connection, db_type = get_db_connection(env_vars)
        cursor = connection.cursor()
        
        # Check if news_articles table exists
        if db_type == 'mysql':
            cursor.execute("""
                SELECT COUNT(*) as count FROM information_schema.tables 
                WHERE table_schema = DATABASE() 
                AND table_name = 'news_articles'
            """)
            result = cursor.fetchone()
            tables_exist = result['count'] > 0
        else:
            cursor.execute("""
                SELECT COUNT(*) as count FROM sqlite_master 
                WHERE type='table' AND name='news_articles'
            """)
            result = cursor.fetchone()
            tables_exist = result[0] > 0
        
        connection.close()
        
        if not tables_exist:
            print("✓ Database tables not found, initializing...")
            # Load and run init_db module
            init_db = load_module(SCRIPT_DIR / 'init_db.py')
            init_db.main()
        else:
            print("✓ Database tables exist")
        
        return True
    except Exception as e:
        print(f"ERROR: Failed to check/initialize database: {e}")
        return False


def get_feeds_needing_update(connection, db_type, feeds):
    """
    Determine which feeds need to be updated based on their refresh interval.

    Args:
        connection: Database connection
        db_type: 'mysql' or 'sqlite'
        feeds: List of feed configurations

    Returns:
        List of feed IDs that need updating
    """
    cursor = connection.cursor()
    current_time = datetime.now()
    feeds_to_update = []

    for feed in feeds:
        feed_id = feed.get('id')
        refresh_minutes = feed.get('refresh', 30)  # Default to 30 minutes
        
        # Get last update time for this feed
        if db_type == 'mysql':
            cursor.execute("""
                SELECT last_updated FROM feed_updates WHERE feed_id = %s
            """, (feed_id,))
        else:
            cursor.execute("""
                SELECT last_updated FROM feed_updates WHERE feed_id = ?
            """, (feed_id,))
        
        result = cursor.fetchone()
        
        if result is None:
            # Never updated, needs update
            feeds_to_update.append(feed_id)
        else:
            # Check if refresh interval has elapsed
            if db_type == 'mysql':
                last_updated = result['last_updated']
            else:
                last_updated = datetime.fromisoformat(result[0])

            time_since_update = current_time - last_updated
            refresh_duration = timedelta(minutes=refresh_minutes)

            if time_since_update >= refresh_duration:
                feeds_to_update.append(feed_id)
    
    return feeds_to_update


def ensure_project_root():
    """Ensure the process runs from the project root so relative paths resolve."""
    try:
        os.chdir(PROJECT_ROOT)
    except OSError as exc:
        print(f"ERROR: Unable to change working directory to {PROJECT_ROOT}: {exc}")
        sys.exit(1)


def main():
    """Main update function."""
    print("=" * 60)
    print("News Feed Update - " + datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    print("=" * 60)

    ensure_project_root()
    
    # Load environment variables
    env_path = PROJECT_ROOT / '.env'
    env_vars = load_env_file(env_path)
    
    # Step 1: Check/initialize database
    if not check_and_init_database(env_vars):
        print("ERROR: Failed to initialize database")
        sys.exit(1)
    
    # Step 2: Load feed configuration
    print("\nLoading feed configuration...")
    try:
        feeds = load_feed_config()
        print(f"✓ Loaded {len(feeds)} feed(s) from config")
    except Exception as e:
        print(f"ERROR: Failed to load feed config: {e}")
        sys.exit(1)
    
    before_stats = {'total': 0, 'oldest': None}
    
    # Step 3: Determine which feeds need updating
    print("\nChecking which feeds need updates...")
    try:
        connection, db_type = get_db_connection(env_vars)
        before_stats = get_database_stats(connection, db_type)
        feeds_to_update = get_feeds_needing_update(connection, db_type, feeds)
        connection.close()
        
        if feeds_to_update:
            print(f"✓ {len(feeds_to_update)} feed(s) need updating")
        else:
            print("✓ No feeds need updating at this time")
    except Exception as e:
        print(f"ERROR: Failed to check feed status: {e}")
        sys.exit(1)
    
    # Step 4: Fetch feeds that need updating
    if feeds_to_update:
        print("\nFetching feeds...")
        try:
            fetch_feeds_mod = load_module(SCRIPT_DIR / 'fetch_feeds.py')
            success_count = fetch_feeds_mod.fetch_feeds(feeds_to_update)
            
            if success_count > 0:
                print(f"✓ Successfully updated {success_count} feed(s)")
            else:
                print("⚠ No feeds were successfully updated")
        except Exception as e:
            print(f"ERROR: Failed to fetch feeds: {e}")
            # Don't exit here, continue with cleanup
    
    # Step 5: Clean up old articles
    print("\nCleaning up old articles...")
    deleted_count = 0
    try:
        cleanup_mod = load_module(SCRIPT_DIR / 'cleanup_db.py')
        deleted_count = cleanup_mod.cleanup_by_feed_lifetime()
        
        if deleted_count > 0:
            print(f"✓ Cleaned up {deleted_count} old article(s)")
        else:
            print("✓ No old articles to clean up")
    except Exception as e:
        print(f"ERROR: Failed to clean up: {e}")
        # Don't exit, this is not critical
    
    print("\nCollecting database statistics...")
    try:
        connection, db_type = get_db_connection(env_vars)
        final_stats = get_database_stats(connection, db_type)
        db_size_mb = get_database_size_mb(env_vars, db_type, connection)
        connection.close()
        
        total_after = final_stats['total']
        total_before = before_stats.get('total', 0)
        added_count = total_after - total_before + deleted_count
        if added_count < 0:
            added_count = 0
        
        oldest_days = compute_age_days(final_stats['oldest'])
        oldest_display = f"{oldest_days} day(s) old" if oldest_days is not None else "N/A"
        
        print("\nDatabase statistics:")
        print(f"  Total articles: {total_after:,}")
        print(f"  Database size: {db_size_mb:.2f} MB")
        print(f"  Oldest article: {oldest_display}")
        print(f"  Entries added this run: {added_count:,}")
        print(f"  Entries removed this run: {deleted_count:,}")
    except Exception as e:
        print(f"ERROR: Failed to collect database stats: {e}")
    
    print("\n" + "=" * 60)
    print("Update complete!")
    print("=" * 60)


if __name__ == '__main__':
    main()
