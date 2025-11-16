"""
Database initialization script for news system.
Creates the necessary tables if they don't exist.
"""
import sys
from db_config import get_db_connection, get_db_config


def init_database():
    """Initialize the database with necessary tables."""
    config = get_db_config()
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        if config['type'] == 'mysql':
            # MySQL syntax
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS news_articles (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    feed_name VARCHAR(100) NOT NULL,
                    url VARCHAR(1000) NOT NULL,
                    title VARCHAR(500) NOT NULL,
                    published_date INT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE KEY unique_article (feed_name, url(255))
                )
            """)
            
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS feed_updates (
                    feed_name VARCHAR(100) PRIMARY KEY,
                    last_updated INT NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                )
            """)
        else:
            # SQLite syntax
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS news_articles (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    feed_name TEXT NOT NULL,
                    url TEXT NOT NULL,
                    title TEXT NOT NULL,
                    published_date INTEGER NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(feed_name, url)
                )
            """)
            
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS feed_updates (
                    feed_name TEXT PRIMARY KEY,
                    last_updated INTEGER NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
        
        # Create indices for better query performance
        try:
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_published_date 
                ON news_articles(published_date DESC)
            """)
        except Exception:
            # Index might already exist in MySQL
            pass
        
        try:
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_feed_name 
                ON news_articles(feed_name)
            """)
        except Exception:
            # Index might already exist in MySQL
            pass
        
        conn.commit()
        print(f"Database initialized successfully (type: {config['type']})")
        if config['type'] == 'sqlite':
            print(f"Database location: {config['path']}")
        return True
        
    except Exception as e:
        print(f"Error initializing database: {e}", file=sys.stderr)
        conn.rollback()
        return False
    finally:
        cursor.close()
        conn.close()


if __name__ == '__main__':
    success = init_database()
    sys.exit(0 if success else 1)
