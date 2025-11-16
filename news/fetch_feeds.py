"""
RSS feed fetching and parsing module.
"""
import sys
import time
import xml.etree.ElementTree as ET
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError
from datetime import datetime
import re


def parse_date(date_string):
    """
    Parse various date formats and return Unix timestamp.
    Returns current time if parsing fails.
    """
    if not date_string:
        return int(time.time())
    
    # Try multiple date formats
    date_formats = [
        '%a, %d %b %Y %H:%M:%S %z',  # RFC 822
        '%a, %d %b %Y %H:%M:%S %Z',
        '%Y-%m-%dT%H:%M:%S%z',        # ISO 8601 with timezone
        '%Y-%m-%dT%H:%M:%SZ',         # ISO 8601 UTC
        '%Y-%m-%dT%H:%M:%S',          # ISO 8601 without timezone
    ]
    
    # Clean up the date string
    date_string = date_string.strip()
    
    # Remove milliseconds if present (e.g., .123)
    date_string = re.sub(r'\.\d+', '', date_string)
    
    for fmt in date_formats:
        try:
            dt = datetime.strptime(date_string, fmt)
            return int(dt.timestamp())
        except ValueError:
            continue
    
    # If all parsing attempts fail, return current time
    print(f"Warning: Could not parse date '{date_string}', using current time", file=sys.stderr)
    return int(time.time())


def fetch_rss_feed(url, timeout=5):
    """
    Fetch an RSS feed from the given URL.
    Returns the raw XML content or None if fetch fails.
    """
    try:
        req = Request(url, headers={'User-Agent': 'Mozilla/5.0 (compatible; RSS Reader/1.0)'})
        with urlopen(req, timeout=timeout) as response:
            content = response.read()
            return content
    except (URLError, HTTPError, TimeoutError) as e:
        print(f"Error fetching feed from {url}: {e}", file=sys.stderr)
        return None


def parse_rss_feed(xml_content, feed_name, max_items=32):
    """
    Parse RSS/Atom feed XML and extract articles.
    Returns a list of article dictionaries with keys: feed_name, url, title, published_date
    """
    if not xml_content:
        return []
    
    articles = []
    
    try:
        root = ET.fromstring(xml_content)
        
        # Determine feed type and get items
        items = []
        
        # Standard RSS format
        if root.find('channel') is not None:
            channel = root.find('channel')
            items = channel.findall('item')
        # Atom format
        elif root.tag.endswith('feed'):
            items = root.findall('{http://www.w3.org/2005/Atom}entry')
            if not items:  # Try without namespace
                items = root.findall('entry')
        # Some non-standard RSS variants
        elif root.findall('item'):
            items = root.findall('item')
        
        for item in items[:max_items]:
            try:
                # Extract title
                title_elem = item.find('title')
                if title_elem is None:
                    title_elem = item.find('{http://www.w3.org/2005/Atom}title')
                title = title_elem.text.strip() if title_elem is not None and title_elem.text else "No Title"
                
                # Extract link
                link = None
                link_elem = item.find('link')
                if link_elem is not None:
                    # Could be text content or href attribute
                    if link_elem.text:
                        link = link_elem.text.strip()
                    elif link_elem.get('href'):
                        link = link_elem.get('href')
                
                # Try atom link format
                if not link:
                    link_elem = item.find('{http://www.w3.org/2005/Atom}link')
                    if link_elem is not None:
                        link = link_elem.get('href')
                
                # Try guid as fallback
                if not link:
                    guid_elem = item.find('guid')
                    if guid_elem is not None and guid_elem.text:
                        guid = guid_elem.text.strip()
                        # Only use guid if it looks like a URL
                        if guid.startswith('http'):
                            link = guid
                
                # Try id as fallback (Atom)
                if not link:
                    id_elem = item.find('{http://www.w3.org/2005/Atom}id')
                    if id_elem is not None and id_elem.text:
                        id_text = id_elem.text.strip()
                        if id_text.startswith('http'):
                            link = id_text
                
                # Skip if no link found
                if not link:
                    continue
                
                # Extract publication date
                date_string = None
                
                # Try various date fields
                for date_field in ['pubDate', 'published', 'updated', '{http://purl.org/dc/elements/1.1/}date',
                                   '{http://www.w3.org/2005/Atom}published', '{http://www.w3.org/2005/Atom}updated']:
                    date_elem = item.find(date_field)
                    if date_elem is not None and date_elem.text:
                        date_string = date_elem.text
                        break
                
                published_date = parse_date(date_string) if date_string else int(time.time())
                
                # Create article dict
                article = {
                    'feed_name': feed_name,
                    'url': link,
                    'title': title,
                    'published_date': published_date
                }
                
                articles.append(article)
                
            except Exception as e:
                print(f"Error parsing item in feed {feed_name}: {e}", file=sys.stderr)
                continue
        
    except ET.ParseError as e:
        print(f"Error parsing XML for feed {feed_name}: {e}", file=sys.stderr)
        return []
    
    return articles


def fetch_and_parse_feed(url, feed_name, max_items=32, timeout=5):
    """
    Fetch and parse an RSS feed in one call.
    Returns a list of article dictionaries.
    """
    xml_content = fetch_rss_feed(url, timeout)
    if xml_content:
        return parse_rss_feed(xml_content, feed_name, max_items)
    return []
