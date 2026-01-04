#!/usr/bin/env python3
"""
Migrate news data from SQLite to MySQL.
Copies all articles and feed update data from the SQLite database to MySQL.
"""

import sys
import sqlite3
from db_utils import load_env_file, resolve_sqlite_path
from init_db import init_database

def get_mysql_connection(env_vars):
    """Get MySQL connection from environment variables."""
    if not env_vars.get('SQL_HOST'):
        print("ERROR: MySQL configuration not found in .env file")
        print("Required variables: SQL_HOST, SQL_USER, SQL_PASS, SQL_DB_NAME")
        sys.exit(1)

    try:
        import pymysql
        connection = pymysql.connect(
            host='localhost',
            user=env_vars.get('SQL_USER'),
            password=env_vars.get('SQL_PASS'),
            database=env_vars.get('SQL_DB_NAME'),
            charset='utf8mb4',
            cursorclass=pymysql.cursors.DictCursor
        )
        return connection
    except ImportError:
        print("ERROR: pymysql package required for MySQL connection")
        print("Install with: pip install pymysql")
        sys.exit(1)
    except Exception as e:
        print(f"ERROR: Failed to connect to MySQL: {e}")
        sys.exit(1)


def get_sqlite_connection(env_vars):
    """Get SQLite connection."""
    db_path = resolve_sqlite_path(env_vars)
    print(f"Reading from SQLite database: {db_path}")

    try:
        connection = sqlite3.connect(db_path)
        connection.row_factory = sqlite3.Row
        return connection
    except Exception as e:
        print(f"ERROR: Failed to connect to SQLite: {e}")
        sys.exit(1)


def migrate_news_articles(sqlite_conn, mysql_conn):
    """Migrate news articles from SQLite to MySQL."""
    print("\nMigrating news_articles...")

    # Read from SQLite
    sqlite_cursor = sqlite_conn.cursor()
    sqlite_cursor.execute("""
        SELECT feed_id, url, title, published_date, created_at
        FROM news_articles
        ORDER BY id
    """)
    articles = sqlite_cursor.fetchall()

    if not articles:
        print("  No articles to migrate")
        return 0

    # Write to MySQL
    mysql_cursor = mysql_conn.cursor()
    migrated = 0
    skipped = 0

    for article in articles:
        try:
            mysql_cursor.execute("""
                INSERT INTO news_articles
                (feed_id, url, title, published_date, created_at)
                VALUES (%s, %s, %s, %s, %s)
            """, (
                article['feed_id'],
                article['url'],
                article['title'],
                article['published_date'],
                article['created_at']
            ))
            migrated += 1
        except Exception as e:
            # Skip duplicates (likely already exists)
            if 'Duplicate entry' in str(e):
                skipped += 1
            else:
                print(f"  WARNING: Failed to insert article: {e}")
                skipped += 1

    mysql_conn.commit()
    print(f"  ✓ Migrated {migrated} articles ({skipped} skipped/duplicates)")
    return migrated


def migrate_feed_updates(sqlite_conn, mysql_conn):
    """Migrate feed update timestamps from SQLite to MySQL."""
    print("\nMigrating feed_updates...")

    # Read from SQLite
    sqlite_cursor = sqlite_conn.cursor()
    sqlite_cursor.execute("""
        SELECT feed_id, last_updated, last_check, update_count
        FROM feed_updates
    """)
    updates = sqlite_cursor.fetchall()

    if not updates:
        print("  No feed updates to migrate")
        return 0

    # Write to MySQL
    mysql_cursor = mysql_conn.cursor()
    migrated = 0

    for update in updates:
        try:
            mysql_cursor.execute("""
                INSERT INTO feed_updates
                (feed_id, last_updated, last_check, update_count)
                VALUES (%s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                    last_updated = VALUES(last_updated),
                    last_check = VALUES(last_check),
                    update_count = VALUES(update_count)
            """, (
                update['feed_id'],
                update['last_updated'],
                update['last_check'],
                update['update_count']
            ))
            migrated += 1
        except Exception as e:
            print(f"  WARNING: Failed to update feed {update['feed_id']}: {e}")

    mysql_conn.commit()
    print(f"  ✓ Migrated {migrated} feed update records")
    return migrated


def main():
    """Main migration function."""
    print("=" * 60)
    print("SQLite to MySQL Migration Tool")
    print("=" * 60)

    # Load environment variables
    env_vars = load_env_file()

    # Connect to both databases
    sqlite_conn = get_sqlite_connection(env_vars)
    mysql_conn = get_mysql_connection(env_vars)
    print(f"✓ Connected to MySQL database")

    try:
        # Initialize MySQL tables (if they don't exist)
        print("\nInitializing MySQL tables...")
        init_database(mysql_conn, 'mysql')

        # Migrate data
        articles_count = migrate_news_articles(sqlite_conn, mysql_conn)
        feeds_count = migrate_feed_updates(sqlite_conn, mysql_conn)

        # Summary
        print("\n" + "=" * 60)
        print("Migration Summary:")
        print(f"  Articles migrated: {articles_count}")
        print(f"  Feed updates migrated: {feeds_count}")
        print("=" * 60)
        print("\n✓ Migration complete!")

    except Exception as e:
        print(f"\nERROR: Migration failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        sqlite_conn.close()
        mysql_conn.close()


if __name__ == '__main__':
    main()
