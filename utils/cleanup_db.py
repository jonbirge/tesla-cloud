#!/usr/bin/env python3
"""
Clean up old news articles from the database.
Removes articles older than the configured lifetime.
"""

import sys
from datetime import datetime, timedelta

from db_utils import load_env_file, get_db_connection, load_feed_config


def cleanup_old_articles(connection, db_type, max_age_days=7):
    """
    Remove articles older than max_age_days.
    
    Args:
        connection: Database connection
        db_type: 'mysql' or 'sqlite'
        max_age_days: Maximum age in days (default: 7)
    """
    cursor = connection.cursor()
    cutoff_date = datetime.now() - timedelta(days=max_age_days)
    
    if db_type == 'mysql':
        cursor.execute("""
            DELETE FROM news_articles 
            WHERE published_date < %s
        """, (cutoff_date,))
    else:
        cursor.execute("""
            DELETE FROM news_articles 
            WHERE published_date < ?
        """, (cutoff_date,))
    
    deleted_count = cursor.rowcount
    connection.commit()
    
    return deleted_count


def cleanup_by_feed_lifetime():
    """
    Clean up articles based on each feed's configured lifetime.
    Feeds with no lifetime or a lifetime <= 0 are treated as infinite
    retention and are never pruned automatically.
    """
    # Load environment and get DB connection
    env_vars = load_env_file()
    connection, db_type = get_db_connection(env_vars)
    
    # Load feed configuration
    feeds = load_feed_config()
    
    # Build a map of feed_id to lifetime (in days)
    feed_lifetimes = {}
    for feed in feeds:
        feed_id = feed.get('id')
        if not feed_id:
            continue

        lifetime_value = feed.get('lifetime')
        if lifetime_value is None:
            # A missing lifetime means infinite retention
            continue

        try:
            lifetime = float(lifetime_value)
        except (TypeError, ValueError):
            print(f"⚠ Invalid lifetime '{lifetime_value}' for feed '{feed_id}', skipping cleanup for this feed")
            continue

        if lifetime <= 0:
            # Zero or negative lifetime means keep forever
            continue

        if lifetime.is_integer():
            lifetime = int(lifetime)

        feed_lifetimes[feed_id] = lifetime

    if not feed_lifetimes:
        connection.close()
        print("No feeds have a finite lifetime. Skipping cleanup.")
        return 0
    
    # Get unique lifetime values to minimize DB queries
    unique_lifetimes = set(feed_lifetimes.values())
    
    total_deleted = 0
    
    for lifetime in sorted(unique_lifetimes):
        # Get all feeds with this lifetime
        feed_ids_with_lifetime = [fid for fid, lt in feed_lifetimes.items() if lt == lifetime]
        
        if not feed_ids_with_lifetime:
            continue
        
        # Delete articles older than this lifetime for these feeds
        cursor = connection.cursor()
        cutoff_date = datetime.now() - timedelta(days=lifetime)
        
        placeholders = ','.join(['%s' if db_type == 'mysql' else '?'] * len(feed_ids_with_lifetime))
        
        if db_type == 'mysql':
            query = f"""
                DELETE FROM news_articles 
                WHERE feed_id IN ({placeholders})
                AND published_date < %s
            """
            cursor.execute(query, (*feed_ids_with_lifetime, cutoff_date))
        else:
            query = f"""
                DELETE FROM news_articles 
                WHERE feed_id IN ({placeholders})
                AND published_date < ?
            """
            cursor.execute(query, (*feed_ids_with_lifetime, cutoff_date))
        
        deleted_count = cursor.rowcount
        total_deleted += deleted_count
        
        if deleted_count > 0:
            print(f"✓ Deleted {deleted_count} articles older than {lifetime} days from {len(feed_ids_with_lifetime)} feed(s)")
    
    connection.commit()
    connection.close()
    
    print(f"\nTotal cleanup: {total_deleted} articles removed")
    return total_deleted


def main():
    """Main function."""
    # Check for command line arguments
    if len(sys.argv) > 1:
        try:
            max_age = float(sys.argv[1])
            print(f"Cleaning up articles older than {max_age} days...")

            # Load environment and get DB connection
            env_vars = load_env_file()
            connection, db_type = get_db_connection(env_vars)
            
            deleted = cleanup_old_articles(connection, db_type, max_age)
            connection.close()
            
            print(f"✓ Deleted {deleted} articles")
        except ValueError:
            print("ERROR: Invalid age value. Please provide a number (days)")
            sys.exit(1)
        except Exception as e:
            print(f"ERROR: {e}")
            sys.exit(1)
    else:
        # Use feed-specific lifetimes from config
        print("Cleaning up articles based on feed lifetimes...")
        try:
            cleanup_by_feed_lifetime()
        except Exception as e:
            print(f"ERROR: {e}")
            sys.exit(1)


if __name__ == '__main__':
    main()
