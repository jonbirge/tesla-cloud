#!/usr/bin/env python3
"""
Display statistics about news articles in the database.
Shows article count and age of most recent article for each news source.
"""

from datetime import datetime
from db_utils import load_env_file, get_db_connection


def get_feed_stats(connection, db_type):
    """Get article count and most recent/oldest article dates for each feed."""
    cursor = connection.cursor()

    if db_type == 'mysql':
        cursor.execute("""
            SELECT
                feed_id,
                COUNT(*) as article_count,
                MAX(published_date) as most_recent,
                MIN(published_date) as oldest
            FROM news_articles
            GROUP BY feed_id
            ORDER BY feed_id
        """)
        results = cursor.fetchall()
        # Convert DictCursor results to list of dicts
        stats = [dict(row) for row in results]
    else:
        cursor.execute("""
            SELECT
                feed_id,
                COUNT(*) as article_count,
                MAX(published_date) as most_recent,
                MIN(published_date) as oldest
            FROM news_articles
            GROUP BY feed_id
            ORDER BY feed_id
        """)
        results = cursor.fetchall()
        # Convert sqlite3.Row to list of dicts
        stats = [dict(row) for row in results]

    return stats


def calculate_age_hours(date_string):
    """Calculate age in hours from a datetime string."""
    if not date_string:
        return None

    try:
        # Parse the date string
        if isinstance(date_string, datetime):
            article_date = date_string
        else:
            # Replace space with 'T' for ISO format compatibility
            date_str = str(date_string).replace(' ', 'T')
            article_date = datetime.fromisoformat(date_str)

        # Remove timezone info for comparison (treat all as UTC)
        if article_date.tzinfo is not None:
            # Convert to naive datetime (drop timezone)
            article_date = article_date.replace(tzinfo=None)

        # Calculate difference (using naive datetimes)
        now = datetime.now()
        diff = now - article_date
        hours = diff.total_seconds() / 3600

        return hours
    except Exception as e:
        # Silently handle errors (don't print them)
        return None


def format_age(hours):
    """Format age in hours to a human-readable string."""
    if hours is None:
        return "N/A"

    if hours < 1:
        minutes = int(hours * 60)
        return f"{minutes}m"
    elif hours < 24:
        return f"{hours:.1f}h"
    else:
        days = hours / 24
        return f"{days:.1f}d"


def print_stats(stats):
    """Print statistics in a formatted table."""
    if not stats:
        print("No articles found in database.")
        return

    print("\nNews Article Statistics")
    print("=" * 85)
    print(f"{'Feed ID':<30} {'Articles':<12} {'Newest':<12} {'Oldest':<12}")
    print("-" * 85)

    total_articles = 0

    for stat in stats:
        feed_id = stat['feed_id']
        count = stat['article_count']
        most_recent = stat['most_recent']
        oldest = stat['oldest']

        newest_hours = calculate_age_hours(most_recent)
        newest_str = format_age(newest_hours)

        oldest_hours = calculate_age_hours(oldest)
        oldest_str = format_age(oldest_hours)

        print(f"{feed_id:<30} {count:<12} {newest_str:<12} {oldest_str:<12}")
        total_articles += count

    print("-" * 85)
    print(f"{'TOTAL':<30} {total_articles:<12}")
    print("=" * 85)


def main():
    """Main function to display database statistics."""
    # Load environment variables
    env_vars = load_env_file()

    # Get database connection
    connection, db_type = get_db_connection(env_vars)

    try:
        # Get and display statistics
        stats = get_feed_stats(connection, db_type)
        print_stats(stats)
    finally:
        connection.close()


if __name__ == '__main__':
    main()
