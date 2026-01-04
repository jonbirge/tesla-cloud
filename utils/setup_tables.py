#!/usr/bin/env python3
"""
Setup all database tables for Tesla Cloud application.
Creates all necessary tables for the application to function.
Run this script once during initial setup or after database reset.
"""

import sys
import sqlite3
from pathlib import Path
from db_utils import load_env_file


def get_connection_info(env_vars):
    """
    Determine database connection type and parameters.
    Returns tuple of (connection_type, connection_params).
    """
    # Check for MySQL configuration
    if env_vars.get('SQL_HOST'):
        # MySQL/MariaDB connection
        return 'mysql', {
            'host': env_vars.get('SQL_HOST'),
            'user': env_vars.get('SQL_USER'),
            'password': env_vars.get('SQL_PASS'),
            'database': env_vars.get('SQL_DB_NAME'),
            'charset': 'utf8mb4'
        }
    else:
        # SQLite - we'll handle multiple paths for development
        return 'sqlite', None


def setup_tables_mysql(connection):
    """Create all database tables for MySQL."""
    cursor = connection.cursor()
    
    print("Creating database tables for MySQL...")
    
    # Table 1: user_settings (from settings.php)
    print("  - Creating user_settings table...")
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS user_settings (
            user_id VARCHAR(255) NOT NULL,
            setting_key VARCHAR(64) NOT NULL,
            setting_value TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, setting_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """)
    
    # Table 2: user_ids (from settings.php)
    print("  - Creating user_ids table...")
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS user_ids (
            user_id VARCHAR(255) NOT NULL,
            initial_login TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_login TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_ip VARCHAR(45),
            login_count INT DEFAULT 0,
            auto_created TINYINT DEFAULT 0,
            PRIMARY KEY (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """)
    
    # Table 3: login_hist (from settings.php)
    print("  - Creating login_hist table...")
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS login_hist (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id VARCHAR(255) NOT NULL,
            login_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            ip_address VARCHAR(45) NOT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """)
    
    # Table 4: ping_data (from ping.php)
    print("  - Creating ping_data table...")
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS ping_data (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id VARCHAR(255) NOT NULL,
            latitude DOUBLE NULL,
            longitude DOUBLE NULL,
            altitude DOUBLE NULL,
            ip_address VARCHAR(45) NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """)
    
    # Table 5: key_value (from rest_db.php)
    print("  - Creating key_value table...")
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS key_value (
            `key` VARCHAR(255) NOT NULL PRIMARY KEY,
            `value` TEXT NULL,
            `life_time` FLOAT DEFAULT 30,
            `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
            `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """)
    
    # Table 6: news_articles (from init_db.py)
    print("  - Creating news_articles table...")
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
    
    # Table 7: feed_updates (from init_db.py)
    print("  - Creating feed_updates table...")
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS feed_updates (
            feed_id VARCHAR(50) PRIMARY KEY,
            last_updated DATETIME NOT NULL,
            last_check DATETIME DEFAULT CURRENT_TIMESTAMP,
            update_count INT DEFAULT 0
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """)
    
    connection.commit()
    print("✓ All MySQL tables created successfully")


def setup_tables_sqlite(db_path):
    """Create all database tables for a SQLite database file."""
    print(f"Creating database tables for SQLite: {db_path}")
    
    # Create directory if it doesn't exist
    db_dir = Path(db_path).parent
    db_dir.mkdir(parents=True, exist_ok=True)
    
    connection = sqlite3.connect(db_path)
    cursor = connection.cursor()
    
    # Table 1: user_settings (from settings.php)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS user_settings (
            user_id TEXT NOT NULL,
            setting_key TEXT NOT NULL,
            setting_value TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, setting_key)
        )
    """)
    
    # Table 2: user_ids (from settings.php)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS user_ids (
            user_id TEXT PRIMARY KEY,
            initial_login DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_login DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_ip TEXT,
            login_count INTEGER DEFAULT 0,
            auto_created INTEGER DEFAULT 0
        )
    """)
    
    # Table 3: login_hist (from settings.php)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS login_hist (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            login_time DATETIME DEFAULT CURRENT_TIMESTAMP,
            ip_address TEXT NOT NULL
        )
    """)
    
    # Table 4: ping_data (from ping.php)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS ping_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            latitude REAL NULL,
            longitude REAL NULL,
            altitude REAL NULL,
            ip_address TEXT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    # Table 5: key_value (from rest_db.php)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS key_value (
            `key` TEXT NOT NULL PRIMARY KEY,
            `value` TEXT NULL,
            `life_time` REAL DEFAULT 30,
            `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
            `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    # Table 6: news_articles (from init_db.py)
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
    
    # Table 7: feed_updates (from init_db.py)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS feed_updates (
            feed_id TEXT PRIMARY KEY,
            last_updated DATETIME NOT NULL,
            last_check DATETIME DEFAULT CURRENT_TIMESTAMP,
            update_count INTEGER DEFAULT 0
        )
    """)
    
    connection.commit()
    connection.close()
    print(f"✓ All tables created in {db_path}")


def main():
    """Main function to setup all database tables."""
    print("Tesla Cloud - Database Table Setup")
    print("=" * 50)
    
    # Load environment variables from .env file
    env_vars = load_env_file()
    
    # Get connection info
    conn_type, conn_params = get_connection_info(env_vars)
    
    if conn_type == 'mysql':
        # MySQL setup - all tables in one database
        print("\nConnecting to MySQL database...")
        try:
            import pymysql
            connection = pymysql.connect(
                host=conn_params['host'],
                user=conn_params['user'],
                password=conn_params['password'],
                database=conn_params['database'],
                charset=conn_params['charset']
            )
            print(f"✓ Connected to MySQL database: {conn_params['database']}")
            
            try:
                setup_tables_mysql(connection)
            finally:
                connection.close()
                print("\n✓ Database connection closed")
        except ImportError:
            print("ERROR: pymysql package required for MySQL connection")
            print("Install with: pip install pymysql")
            sys.exit(1)
        except Exception as e:
            print(f"ERROR: Failed to connect to MySQL: {e}")
            sys.exit(1)
    else:
        # SQLite setup - create tables in multiple database files for development
        print("\nNo MySQL configuration found, using SQLite databases...")
        print("Creating tables in all SQLite database locations...")
        
        # Define all SQLite database paths used by different PHP scripts
        script_dir = Path(__file__).resolve().parent
        project_root = script_dir.parent
        
        sqlite_paths = [
            # rest_db.php default
            '/tmp/restdb.sqlite',
            # settings.php default
            '/tmp/teslacloud_settings.db',
            # news.php and Python utilities default
            str(script_dir / 'news_articles.db'),
        ]
        
        # Add custom SQLITE_PATH from env if specified
        if env_vars.get('SQLITE_PATH'):
            custom_path = env_vars.get('SQLITE_PATH')
            if custom_path not in sqlite_paths:
                sqlite_paths.append(custom_path)
        
        # Create tables in each SQLite database
        for db_path in sqlite_paths:
            setup_tables_sqlite(db_path)
    
    print("\n" + "=" * 50)
    print("Database setup complete!")
    print("\nAll tables are ready for use.")
    
    if conn_type == 'sqlite':
        print("\nNote: Tables created in multiple SQLite files for development:")
        for path in sqlite_paths:
            print(f"  - {path}")


if __name__ == '__main__':
    main()
