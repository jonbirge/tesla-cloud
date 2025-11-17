#!/usr/bin/env python3
"""
Fetch news feeds and store articles in the database.
Reads feed definitions from config/news.json and fetches RSS feeds.
"""

import sys
from datetime import datetime
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime

from logging_utils import setup_dual_logging
from db_utils import load_env_file, get_db_connection, load_feed_config

setup_dual_logging()


def parse_date(date_string):
    """Parse various date formats to datetime object."""
    if not date_string:
        return datetime.now()
    
    try:
        # Try RFC 2822 format (common in RSS)
        return parsedate_to_datetime(date_string)
    except (TypeError, ValueError):
        pass
    
    # Try ISO 8601 format
    try:
        # Remove timezone info for simplicity, parse as UTC
        date_string = date_string.split('.')[0]  # Remove microseconds
        date_string = date_string.replace('Z', '+00:00')
        if '+' in date_string or date_string.endswith('00:00'):
            date_string = date_string.split('+')[0].split('-')[0]
        return datetime.fromisoformat(date_string)
    except (ValueError, AttributeError):
        pass
    
    # Fallback to current time
    return datetime.now()


def fetch_rss_feed(url, timeout=10):
    """Fetch RSS feed from URL."""
    try:
        req = Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (compatible; RSS Reader/1.0)'
        })
        with urlopen(req, timeout=timeout) as response:
            return response.read()
    except (URLError, HTTPError) as e:
        print(f"  ✗ Failed to fetch feed: {e}")
        return None
    except Exception as e:
        print(f"  ✗ Error fetching feed: {e}")
        return None


def parse_rss_feed(xml_data):
    """Parse RSS/Atom feed and extract articles."""
    articles = []
    
    try:
        root = ET.fromstring(xml_data)
        
        # Handle RSS 2.0 format
        for item in root.findall('.//item'):
            title = item.find('title')
            link = item.find('link')
            pub_date = item.find('pubDate')
            
            if title is not None and link is not None:
                articles.append({
                    'title': title.text or 'No Title',
                    'url': link.text or '',
                    'date': parse_date(pub_date.text if pub_date is not None else None)
                })
        
        # Handle Atom format
        if not articles:
            # Define Atom namespace
            ns = {'atom': 'http://www.w3.org/2005/Atom'}
            for entry in root.findall('.//atom:entry', ns):
                title = entry.find('atom:title', ns)
                link = entry.find('atom:link[@rel="alternate"]', ns)
                if link is None:
                    link = entry.find('atom:link', ns)
                pub_date = entry.find('atom:published', ns)
                if pub_date is None:
                    pub_date = entry.find('atom:updated', ns)
                
                if title is not None and link is not None:
                    link_href = link.get('href', '')
                    articles.append({
                        'title': title.text or 'No Title',
                        'url': link_href,
                        'date': parse_date(pub_date.text if pub_date is not None else None)
                    })
    
    except ET.ParseError as e:
        print(f"  ✗ Failed to parse XML: {e}")
        return []
    
    return articles


def store_articles(connection, db_type, feed_id, articles):
    """Store articles in database."""
    cursor = connection.cursor()
    stored_count = 0
    
    for article in articles:
        try:
            if db_type == 'mysql':
                cursor.execute("""
                    INSERT INTO news_articles (feed_id, url, title, published_date)
                    VALUES (%s, %s, %s, %s)
                    ON DUPLICATE KEY UPDATE title = VALUES(title)
                """, (feed_id, article['url'], article['title'], article['date']))
            else:
                cursor.execute("""
                    INSERT OR REPLACE INTO news_articles (feed_id, url, title, published_date)
                    VALUES (?, ?, ?, ?)
                """, (feed_id, article['url'], article['title'], article['date']))
            
            if cursor.rowcount > 0:
                stored_count += 1
        except Exception as e:
            print(f"  ✗ Error storing article: {e}")
            continue
    
    connection.commit()
    return stored_count


def update_feed_timestamp(connection, db_type, feed_id):
    """Update the last_updated timestamp for a feed."""
    cursor = connection.cursor()
    now = datetime.now()
    
    try:
        if db_type == 'mysql':
            cursor.execute("""
                INSERT INTO feed_updates (feed_id, last_updated, last_check, update_count)
                VALUES (%s, %s, %s, 1)
                ON DUPLICATE KEY UPDATE 
                    last_updated = VALUES(last_updated),
                    last_check = VALUES(last_check),
                    update_count = update_count + 1
            """, (feed_id, now, now))
        else:
            cursor.execute("""
                INSERT OR REPLACE INTO feed_updates (feed_id, last_updated, last_check, update_count)
                VALUES (?, ?, ?, COALESCE((SELECT update_count FROM feed_updates WHERE feed_id = ?), 0) + 1)
            """, (feed_id, now, now, feed_id))
        
        connection.commit()
    except Exception as e:
        print(f"  ✗ Error updating timestamp: {e}")


def fetch_feed(connection, db_type, feed):
    """Fetch a single feed and store its articles."""
    feed_id = feed.get('id')
    feed_name = feed.get('name', feed_id)
    feed_url = feed.get('url')
    
    print(f"  Fetching {feed_name} ({feed_id})...")
    
    # Fetch the RSS feed
    xml_data = fetch_rss_feed(feed_url)
    if not xml_data:
        return False
    
    # Parse the feed
    articles = parse_rss_feed(xml_data)
    if not articles:
        print(f"  ✗ No articles found")
        return False
    
    # Store articles
    stored_count = store_articles(connection, db_type, feed_id, articles)
    print(f"  ✓ Stored {stored_count} articles (fetched {len(articles)})")
    
    # Update feed timestamp
    update_feed_timestamp(connection, db_type, feed_id)
    
    return True


def fetch_feeds(feed_ids=None):
    """
    Fetch specified feeds or all feeds if feed_ids is None.

    Args:
        feed_ids: List of feed IDs to fetch, or None to fetch all feeds
    """
    # Load environment and get DB connection
    env_vars = load_env_file()
    connection, db_type = get_db_connection(env_vars)
    
    # Load feed configuration
    feeds = load_feed_config()
    
    # Filter feeds if specific IDs requested
    if feed_ids:
        feeds = [f for f in feeds if f.get('id') in feed_ids]
    
    print(f"Fetching {len(feeds)} feed(s)...")
    
    success_count = 0
    for feed in feeds:
        try:
            if fetch_feed(connection, db_type, feed):
                success_count += 1
        except Exception as e:
            print(f"  ✗ Error processing feed: {e}")
            continue
    
    connection.close()
    
    print(f"\nCompleted: {success_count}/{len(feeds)} feeds fetched successfully")
    return success_count


def main():
    """Main function."""
    # Check for command line arguments (specific feed IDs)
    feed_ids = sys.argv[1:] if len(sys.argv) > 1 else None
    
    try:
        fetch_feeds(feed_ids)
    except Exception as e:
        print(f"ERROR: {e}")
        sys.exit(1)


if __name__ == '__main__':
    main()
