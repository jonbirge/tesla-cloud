#!/usr/bin/env python3
"""
Main update script for news feeds.
This is the entry point for cron jobs.
Handles initialization, fetching feeds that need updates, and cleanup.
"""

import os
import sys
from datetime import datetime, timedelta, timezone

from db_utils import (
    PROJECT_ROOT,
    load_env_file,
    get_db_connection,
    load_feed_config,
    resolve_sqlite_path
)
import init_db
import fetch_feeds
import cleanup_db


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


def format_last_updated(value):
    """Format last_updated values from either SQLite or MySQL for logging."""
    if not value:
        return "never"
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value)
        except ValueError:
            return str(value)
    if isinstance(value, datetime):
        if value.tzinfo is not None:
            value = value.astimezone(timezone.utc).replace(tzinfo=None)
        return value.strftime("%Y-%m-%d %H:%M:%S")
    return str(value)


def parse_last_updated(value):
    """Normalize the last_updated value to a datetime when possible."""
    if isinstance(value, datetime):
        if value.tzinfo is not None:
            return value.astimezone(timezone.utc).replace(tzinfo=None)
        return value
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value)
            if parsed.tzinfo is not None:
                parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
            return parsed
        except ValueError:
            return None
    return None


def remove_future_dated_articles(env_vars):
    """Remove articles whose published date is in the future."""
    connection, db_type = get_db_connection(env_vars)
    cursor = connection.cursor()
    now = datetime.now()
    now_value = now if db_type == 'mysql' else now.isoformat(sep=' ')

    try:
        if db_type == 'mysql':
            cursor.execute("""
                DELETE FROM news_articles
                WHERE published_date > %s
            """, (now_value,))
        else:
            cursor.execute("""
                DELETE FROM news_articles
                WHERE published_date > ?
            """, (now_value,))

        removed_count = cursor.rowcount if cursor.rowcount is not None else 0
        connection.commit()
        return removed_count
    finally:
        connection.close()


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

    print("  Feed update disposition:")

    for feed in feeds:
        feed_id = feed.get('id')
        feed_name = feed.get('name', feed_id)
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
        last_updated_raw = None if result is None else (
            result['last_updated'] if db_type == 'mysql' else result[0]
        )
        last_updated = parse_last_updated(last_updated_raw)
        last_updated_display = format_last_updated(last_updated_raw)
        refresh_duration = timedelta(minutes=refresh_minutes)
        feed_label = f"{feed_id}"
        
        if last_updated is None:
            # Never updated, needs update
            print(f"  + {feed_label}: due (last updated {last_updated_display}, interval {refresh_minutes}m)")
            feeds_to_update.append(feed_id)
        else:
            # Check if refresh interval has elapsed
            time_since_update = current_time - last_updated
            minutes_until_refresh = max(
                int(round((refresh_duration - time_since_update).total_seconds() / 60)),
                0
            )

            if time_since_update >= refresh_duration:
                print(f"  + {feed_label}: due (last updated {last_updated_display}, interval {refresh_minutes}m)")
                feeds_to_update.append(feed_id)
            else:
                print(
                    f"  - {feed_label}: not due (last updated {last_updated_display}, "
                    f"{minutes_until_refresh}m until refresh)"
                )
    
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
    env_vars = load_env_file()
    
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
            success_count = fetch_feeds.fetch_feeds(feeds_to_update)

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
    future_deleted_count = 0
    try:
        deleted_count = cleanup_db.cleanup_by_feed_lifetime()

        if deleted_count > 0:
            print(f"✓ Cleaned up {deleted_count} old article(s)")
        else:
            print("✓ No old articles to clean up")
    except Exception as e:
        print(f"ERROR: Failed to clean up: {e}")
        # Don't exit, this is not critical

    # Step 6: Remove future-dated articles
    print("\nSanity check: removing future-dated articles...")
    try:
        future_deleted_count = remove_future_dated_articles(env_vars)
        if future_deleted_count > 0:
            print(f"✓ Removed {future_deleted_count} future-dated article(s)")
        else:
            print("✓ No future-dated articles found")
    except Exception as e:
        print(f"ERROR: Failed to remove future-dated articles: {e}")
    
    print("\nCollecting database statistics...")
    try:
        connection, db_type = get_db_connection(env_vars)
        final_stats = get_database_stats(connection, db_type)
        db_size_mb = get_database_size_mb(env_vars, db_type, connection)
        connection.close()
        
        total_after = final_stats['total']
        total_before = before_stats.get('total', 0)
        total_removed = deleted_count + future_deleted_count
        added_count = total_after - total_before + total_removed
        if added_count < 0:
            added_count = 0
        
        oldest_days = compute_age_days(final_stats['oldest'])
        oldest_display = f"{oldest_days} day(s) old" if oldest_days is not None else "N/A"
        
        print("\nDatabase statistics:")
        print(f"  Total articles: {total_after:,}")
        print(f"  Database size: {db_size_mb:.2f} MB")
        print(f"  Oldest article: {oldest_display}")
        print(f"  Entries added this run: {added_count:,}")
        print(f"  Entries removed this run: {total_removed:,}")
    except Exception as e:
        print(f"ERROR: Failed to collect database stats: {e}")
    
    print("\n" + "=" * 60)
    print("Update complete!")
    print("=" * 60)


if __name__ == '__main__':
    main()
