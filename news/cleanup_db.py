#!/usr/bin/env python3
"""
Clean up old news articles from the database.
Removes articles older than the configured lifetime.
"""

import os
import json
import sys
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

from logging_utils import setup_dual_logging

setup_dual_logging()

FORCE_SQLITE = True  # Set to True to force SQLite usage


def load_env_file(env_path):
    """Load environment variables from .env file (JSON or KEY=VALUE)."""
    env_vars = {}
    if not os.path.exists(env_path):
        return env_vars
    
    with open(env_path, 'r') as f:
        content = f.read().strip()
    
    if not content:
        return env_vars
    
    try:
        parsed = json.loads(content)
        if isinstance(parsed, dict):
            return {str(key): value for key, value in parsed.items()}
    except json.JSONDecodeError:
        pass
    
    for line in content.splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            key, value = line.split('=', 1)
            env_vars[key.strip()] = value.strip().strip('"').strip("'")
    
    return env_vars


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
        db_path = env_vars.get('SQLITE_PATH')
        if not db_path:
            # Default to news_articles.db alongside the scripts
            script_dir = Path(__file__).parent
            db_path = str(script_dir / 'news_articles.db')
        
        connection = sqlite3.connect(db_path)
        connection.row_factory = sqlite3.Row
        return connection, 'sqlite'


def load_feed_config():
    """Load news feed configuration from JSON file."""
    script_dir = Path(__file__).parent
    config_path = script_dir.parent / 'config' / 'news.json'
    
    with open(config_path, 'r') as f:
        config = json.load(f)
    
    return config.get('feeds', [])


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
    script_dir = Path(__file__).parent
    env_path = script_dir.parent / '.env'
    
    env_vars = load_env_file(env_path)
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
            script_dir = Path(__file__).parent
            env_path = script_dir.parent / '.env'
            env_vars = load_env_file(env_path)
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
