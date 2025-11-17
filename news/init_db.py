#!/usr/bin/env python3
"""
Initialize the news database with required tables.
Creates tables for storing news articles and feed update timestamps.
"""

from logging_utils import setup_dual_logging
from db_utils import load_env_file, get_db_connection

setup_dual_logging()


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
    env_vars = load_env_file()

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
