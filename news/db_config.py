"""
Database configuration module for news system.
Reads from .env file or falls back to SQLite.
"""
import os
import sqlite3
from pathlib import Path


def load_env_file(env_path=None):
    """Load environment variables from .env file."""
    if env_path is None:
        # Default to ../.env relative to this script's location
        env_path = Path(__file__).parent.parent / '.env'
    
    env_vars = {}
    if env_path.exists():
        with open(env_path, 'r') as f:
            for line in f:
                line = line.strip()
                # Skip comments and empty lines
                if not line or line.startswith('#'):
                    continue
                # Parse KEY=VALUE format
                if '=' in line:
                    key, value = line.split('=', 1)
                    # Remove quotes if present
                    value = value.strip().strip('"').strip("'")
                    env_vars[key.strip()] = value
    return env_vars


def get_db_config():
    """
    Get database configuration from environment variables or defaults.
    Returns a dict with database connection parameters.
    """
    # Load from .env file
    env_vars = load_env_file()
    
    # Check for SQL server configuration
    sql_host = env_vars.get('SQL_HOST') or os.environ.get('SQL_HOST')
    
    if sql_host:
        # Use external SQL server
        config = {
            'type': 'mysql',
            'host': sql_host,
            'user': env_vars.get('SQL_USER') or os.environ.get('SQL_USER'),
            'password': env_vars.get('SQL_PASS') or os.environ.get('SQL_PASS'),
            'database': env_vars.get('SQL_DB_NAME') or os.environ.get('SQL_DB_NAME'),
        }
    else:
        # Default to SQLite
        sqlite_path = env_vars.get('SQLITE_PATH') or os.environ.get('SQLITE_PATH')
        if not sqlite_path:
            # Default to /tmp/news.db
            sqlite_path = '/tmp/news.db'
        
        config = {
            'type': 'sqlite',
            'path': sqlite_path
        }
    
    return config


def get_db_connection():
    """
    Get a database connection based on configuration.
    Returns a connection object compatible with DB-API 2.0.
    """
    config = get_db_config()
    
    if config['type'] == 'mysql':
        import mysql.connector
        conn = mysql.connector.connect(
            host=config['host'],
            user=config['user'],
            password=config['password'],
            database=config['database']
        )
    else:
        # SQLite
        conn = sqlite3.connect(config['path'])
        # Enable foreign keys
        conn.execute('PRAGMA foreign_keys = ON')
    
    return conn
