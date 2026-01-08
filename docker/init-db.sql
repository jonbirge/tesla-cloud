-- Tesla Cloud Database Initialization Script
-- Creates all necessary tables for the application

-- Table 1: user_settings (from settings.php)
CREATE TABLE IF NOT EXISTS user_settings (
    user_id VARCHAR(255) NOT NULL,
    setting_key VARCHAR(64) NOT NULL,
    setting_value TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table 2: user_ids (from settings.php)
CREATE TABLE IF NOT EXISTS user_ids (
    user_id VARCHAR(255) NOT NULL,
    initial_login TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_ip VARCHAR(45),
    login_count INT DEFAULT 0,
    auto_created TINYINT DEFAULT 0,
    PRIMARY KEY (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table 3: login_hist (from settings.php)
CREATE TABLE IF NOT EXISTS login_hist (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    login_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ip_address VARCHAR(45) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table 4: ping_data (from ping.php)
CREATE TABLE IF NOT EXISTS ping_data (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    latitude DOUBLE NULL,
    longitude DOUBLE NULL,
    altitude DOUBLE NULL,
    ip_address VARCHAR(45) NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table 5: key_value (from rest_db.php)
CREATE TABLE IF NOT EXISTS key_value (
    `key` VARCHAR(255) NOT NULL PRIMARY KEY,
    `value` TEXT NULL,
    `life_time` FLOAT DEFAULT 30,
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table 6: news_articles (from news.php)
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table 7: feed_updates (from news.php)
CREATE TABLE IF NOT EXISTS feed_updates (
    feed_id VARCHAR(50) PRIMARY KEY,
    last_updated DATETIME NOT NULL,
    last_check DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_count INT DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
