#!/usr/bin/env python3
"""
Shared database utilities for news scripts.
Provides database connections, environment loading, and configuration parsing.
"""

import os
import json
import sys
import sqlite3
from pathlib import Path

# Configuration constants
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
FORCE_SQLITE = True  # Set to True to force SQLite usage


def load_env_file(env_path=None):
    """Load environment variables from .env file (JSON or KEY=VALUE)."""
    if env_path is None:
        env_path = PROJECT_ROOT / '.env'

    env_vars = {}
    if not os.path.exists(env_path):
        return env_vars

    with open(env_path, 'r') as f:
        content = f.read().strip()

    if not content:
        return env_vars

    # Try JSON first
    try:
        parsed = json.loads(content)
        if isinstance(parsed, dict):
            return {str(key): value for key, value in parsed.items()}
    except json.JSONDecodeError:
        pass

    # Fallback to KEY=VALUE parsing
    for line in content.splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            key, value = line.split('=', 1)
            env_vars[key.strip()] = value.strip().strip('"').strip("'")

    return env_vars


def resolve_sqlite_path(env_vars):
    """Resolve the filesystem path for the SQLite database."""
    return env_vars.get('SQLITE_PATH') or str(SCRIPT_DIR / 'news_articles.db')


def get_db_connection(env_vars):
    """
    Get database connection based on environment variables.
    Returns tuple of (connection, db_type).
    db_type is either 'mysql' or 'sqlite'.
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
        db_path = resolve_sqlite_path(env_vars)
        connection = sqlite3.connect(db_path)
        connection.row_factory = sqlite3.Row
        return connection, 'sqlite'


def load_feed_config():
    """Load news feed configuration from JSON file."""
    config_path = PROJECT_ROOT / 'config' / 'news.json'

    with open(config_path, 'r') as f:
        config = json.load(f)

    return config.get('feeds', [])
