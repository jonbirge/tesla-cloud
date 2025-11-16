#!/usr/bin/env python3
"""
Initialize the news database with required tables.
Creates tables for storing news articles and feed update timestamps.
"""

import os
import json
import sys
import sqlite3
from pathlib import Path

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
            print("Install with: pip install pymysql")
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
            # Default to news_articles.db in parent directory
            script_dir = Path(__file__).parent
            db_path = str(script_dir.parent / 'news_articles.db')
        
        connection = sqlite3.connect(db_path)
        connection.row_factory = sqlite3.Row
        return connection, 'sqlite'


def init_database(connection, db_type):
    """Initialize database tables."""
    cursor = connection.cursor()
    
    if db_type == 'mysql':
        # MySQL syntax
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS news_articles (
                id INT AUTO_INCREMENT PRIMARY KEY,
                feed_id VARCHAR(50) NOT NULL,
                url TEXT NOT NULL,
                title TEXT NOT NULL,
                published_date DATETIME NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY unique_article (feed_id, url(255)),
                INDEX idx_feed_date (feed_id, published_date),
                INDEX idx_published_date (published_date)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """)
        
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS feed_updates (
                feed_id VARCHAR(50) PRIMARY KEY,
                last_updated DATETIME NOT NULL,
                last_check DATETIME DEFAULT CURRENT_TIMESTAMP,
                update_count INT DEFAULT 0
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """)
    else:
        # SQLite syntax
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS news_articles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                feed_id TEXT NOT NULL,
                url TEXT NOT NULL,
                title TEXT NOT NULL,
                published_date DATETIME NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(feed_id, url)
            )
        """)
        
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_feed_date 
            ON news_articles(feed_id, published_date)
        """)
        
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_published_date 
            ON news_articles(published_date)
        """)
        
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS feed_updates (
                feed_id TEXT PRIMARY KEY,
                last_updated DATETIME NOT NULL,
                last_check DATETIME DEFAULT CURRENT_TIMESTAMP,
                update_count INTEGER DEFAULT 0
            )
        """)
    
    connection.commit()
    print("✓ Database tables initialized successfully")


def main():
    """Main function to initialize the database."""
    # Load environment variables
    script_dir = Path(__file__).parent
    env_path = script_dir.parent / '.env'
    env_vars = load_env_file(env_path)
    
    # Get database connection
    print("Initializing news database...")
    connection, db_type = get_db_connection(env_vars)
    print(f"✓ Connected to {db_type} database")
    
    try:
        # Initialize tables
        init_database(connection, db_type)
    finally:
        connection.close()
    
    print("Database initialization complete!")


if __name__ == '__main__':
    main()
