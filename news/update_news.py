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
from datetime import datetime, timedelta
from pathlib import Path
import importlib.util


def load_module(module_path):
    """Dynamically load a Python module from file path."""
    spec = importlib.util.spec_from_file_location("module", module_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_env_file(env_path):
    """Load environment variables from .env file."""
    env_vars = {}
    if os.path.exists(env_path):
        with open(env_path, 'r') as f:
            for line in f:
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
    # Check for MySQL configuration
    if 'SQL_HOST' in env_vars:
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
        # SQLite connection (default)
        db_path = env_vars.get('SQLITE_PATH')
        if not db_path:
            # Default to news_articles.db in parent directory
            script_dir = Path(__file__).parent
            db_path = str(script_dir.parent / 'news_articles.db')
        
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
            script_dir = Path(__file__).parent
            init_db = load_module(script_dir / 'init_db.py')
            init_db.main()
        else:
            print("✓ Database tables exist")
        
        return True
    except Exception as e:
        print(f"ERROR: Failed to check/initialize database: {e}")
        return False


def get_feeds_needing_update(connection, db_type, feeds):
    """
    Determine which feeds need to be updated based on their cache time.
    
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
        cache_minutes = feed.get('cache', 30)  # Default to 30 minutes
        
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
            # Check if cache has expired
            if db_type == 'mysql':
                last_updated = result['last_updated']
            else:
                last_updated = datetime.fromisoformat(result[0])
            
            time_since_update = current_time - last_updated
            cache_duration = timedelta(minutes=cache_minutes)
            
            if time_since_update >= cache_duration:
                feeds_to_update.append(feed_id)
    
    return feeds_to_update


def main():
    """Main update function."""
    print("=" * 60)
    print("News Feed Update - " + datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    print("=" * 60)
    
    # Load environment variables
    script_dir = Path(__file__).parent
    env_path = script_dir.parent / '.env'
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
    
    # Step 3: Determine which feeds need updating
    print("\nChecking which feeds need updates...")
    try:
        connection, db_type = get_db_connection(env_vars)
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
            fetch_feeds_mod = load_module(script_dir / 'fetch_feeds.py')
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
    try:
        cleanup_mod = load_module(script_dir / 'cleanup_db.py')
        deleted_count = cleanup_mod.cleanup_by_feed_lifetime()
        
        if deleted_count > 0:
            print(f"✓ Cleaned up {deleted_count} old article(s)")
        else:
            print("✓ No old articles to clean up")
    except Exception as e:
        print(f"ERROR: Failed to clean up: {e}")
        # Don't exit, this is not critical
    
    print("\n" + "=" * 60)
    print("Update complete!")
    print("=" * 60)


if __name__ == '__main__':
    main()
