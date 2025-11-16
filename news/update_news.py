#!/usr/bin/env python3
"""
Main news update script.
This script should be run by cron to update news feeds.
It handles:
- Database initialization (if needed)
- Reading news feed configuration
- Determining which feeds need updating
- Fetching and storing articles
"""
import sys
import os
import json
import time
from pathlib import Path

# Add current directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from db_config import get_db_connection, get_db_config
from db_init import init_database
from fetch_feeds import fetch_and_parse_feed


def load_news_feeds_config():
    """Load news feeds configuration from JSON file."""
    # Config file is at ../json/news-feeds.json relative to this script
    config_path = Path(__file__).parent.parent / 'json' / 'news-feeds.json'
    
    if not config_path.exists():
        print(f"Error: News feeds configuration not found at {config_path}", file=sys.stderr)
        return []
    
    try:
        with open(config_path, 'r') as f:
            data = json.load(f)
        
        # Extract feeds from the structure
        feeds = data.get('feeds', [])
        return feeds
    except Exception as e:
        print(f"Error loading news feeds configuration: {e}", file=sys.stderr)
        return []


def ensure_database_ready():
    """Ensure database exists and is initialized."""
    try:
        # Try to connect and check if tables exist
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Check if news_articles table exists
        config = get_db_config()
        if config['type'] == 'mysql':
            cursor.execute("""
                SELECT COUNT(*) 
                FROM information_schema.tables 
                WHERE table_schema = DATABASE() 
                AND table_name = 'news_articles'
            """)
            table_exists = cursor.fetchone()[0] > 0
        else:
            cursor.execute("""
                SELECT COUNT(*) 
                FROM sqlite_master 
                WHERE type='table' AND name='news_articles'
            """)
            table_exists = cursor.fetchone()[0] > 0
        
        cursor.close()
        conn.close()
        
        if not table_exists:
            print("Database tables not found, initializing...")
            return init_database()
        
        return True
        
    except Exception as e:
        print(f"Error checking database: {e}", file=sys.stderr)
        print("Attempting to initialize database...")
        return init_database()


def get_feed_last_updated(conn, feed_name):
    """Get the last update timestamp for a feed."""
    cursor = conn.cursor()
    
    config = get_db_config()
    if config['type'] == 'mysql':
        cursor.execute(
            "SELECT last_updated FROM feed_updates WHERE feed_name = %s",
            (feed_name,)
        )
    else:
        cursor.execute(
            "SELECT last_updated FROM feed_updates WHERE feed_name = ?",
            (feed_name,)
        )
    
    result = cursor.fetchone()
    cursor.close()
    
    return result[0] if result else 0


def update_feed_timestamp(conn, feed_name, timestamp):
    """Update the last update timestamp for a feed."""
    cursor = conn.cursor()
    
    config = get_db_config()
    if config['type'] == 'mysql':
        cursor.execute("""
            INSERT INTO feed_updates (feed_name, last_updated)
            VALUES (%s, %s)
            ON DUPLICATE KEY UPDATE last_updated = %s
        """, (feed_name, timestamp, timestamp))
    else:
        cursor.execute("""
            INSERT OR REPLACE INTO feed_updates (feed_name, last_updated)
            VALUES (?, ?)
        """, (feed_name, timestamp))
    
    conn.commit()
    cursor.close()


def store_articles(conn, articles):
    """Store articles in the database, skipping duplicates."""
    if not articles:
        return 0
    
    cursor = conn.cursor()
    stored_count = 0
    
    config = get_db_config()
    for article in articles:
        try:
            if config['type'] == 'mysql':
                cursor.execute("""
                    INSERT IGNORE INTO news_articles 
                    (feed_name, url, title, published_date)
                    VALUES (%s, %s, %s, %s)
                """, (
                    article['feed_name'],
                    article['url'],
                    article['title'],
                    article['published_date']
                ))
            else:
                cursor.execute("""
                    INSERT OR IGNORE INTO news_articles 
                    (feed_name, url, title, published_date)
                    VALUES (?, ?, ?, ?)
                """, (
                    article['feed_name'],
                    article['url'],
                    article['title'],
                    article['published_date']
                ))
            
            if cursor.rowcount > 0:
                stored_count += 1
                
        except Exception as e:
            print(f"Error storing article '{article['title']}': {e}", file=sys.stderr)
            continue
    
    conn.commit()
    cursor.close()
    
    return stored_count


def cleanup_old_articles(conn, max_age_days=7):
    """Remove articles older than max_age_days."""
    cursor = conn.cursor()
    cutoff_timestamp = int(time.time()) - (max_age_days * 86400)
    
    config = get_db_config()
    if config['type'] == 'mysql':
        cursor.execute(
            "DELETE FROM news_articles WHERE published_date < %s",
            (cutoff_timestamp,)
        )
    else:
        cursor.execute(
            "DELETE FROM news_articles WHERE published_date < ?",
            (cutoff_timestamp,)
        )
    
    deleted_count = cursor.rowcount
    conn.commit()
    cursor.close()
    
    if deleted_count > 0:
        print(f"Cleaned up {deleted_count} old articles (older than {max_age_days} days)")
    
    return deleted_count


def update_news(force_update=False):
    """Main update function."""
    print(f"Starting news update at {time.strftime('%Y-%m-%d %H:%M:%S')}")
    
    # Ensure database is ready
    if not ensure_database_ready():
        print("Failed to initialize database", file=sys.stderr)
        return False
    
    # Load feed configuration
    feeds = load_news_feeds_config()
    if not feeds:
        print("No feeds configured", file=sys.stderr)
        return False
    
    print(f"Loaded {len(feeds)} feed configurations")
    
    # Connect to database
    conn = get_db_connection()
    current_time = int(time.time())
    
    feeds_updated = 0
    total_articles_stored = 0
    
    for feed in feeds:
        feed_id = feed.get('id')
        feed_url = feed.get('url')
        feed_name = feed.get('name', feed_id)
        cache_minutes = feed.get('cache', 15)
        
        if not feed_id or not feed_url:
            print(f"Skipping invalid feed config: {feed}", file=sys.stderr)
            continue
        
        # Check if feed needs updating
        last_updated = get_feed_last_updated(conn, feed_id)
        time_since_update = current_time - last_updated
        cache_seconds = cache_minutes * 60
        
        if not force_update and time_since_update < cache_seconds:
            print(f"Skipping {feed_id}: updated {time_since_update}s ago (cache: {cache_seconds}s)")
            continue
        
        print(f"Updating feed: {feed_id} ({feed_name})")
        
        # Fetch and parse feed
        articles = fetch_and_parse_feed(feed_url, feed_id, max_items=32, timeout=5)
        
        if articles:
            # Store articles
            stored_count = store_articles(conn, articles)
            total_articles_stored += stored_count
            print(f"  Fetched {len(articles)} articles, stored {stored_count} new ones")
        else:
            print(f"  No articles fetched from {feed_id}")
        
        # Update feed timestamp (even if no new articles, to avoid hammering failed feeds)
        update_feed_timestamp(conn, feed_id, current_time)
        feeds_updated += 1
    
    # Cleanup old articles
    cleanup_old_articles(conn, max_age_days=7)
    
    conn.close()
    
    print(f"Update complete: {feeds_updated} feeds updated, {total_articles_stored} new articles stored")
    return True


if __name__ == '__main__':
    # Check for --force flag
    force = '--force' in sys.argv
    
    if force:
        print("Force update mode enabled")
    
    success = update_news(force_update=force)
    sys.exit(0 if success else 1)
