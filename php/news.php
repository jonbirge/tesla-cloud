<?php

// Include the git info function
require_once __DIR__ . '/git_info.php';
require_once __DIR__ . '/dotenv.php';

// Set response headers to disable caching
header('Cache-Control: no-cache, no-store, must-revalidate');
header('Expires: 0');

// Buffer output so we can return well-formed JSON even if a fatal error occurs
ob_start();

// Get version information directly using the function
$gitInfo = getGitInfo();
$version = isset($gitInfo['commit']) ? $gitInfo['commit'] : 'unknown';

// Settings
$logFile = '/tmp/rss_php_' . $version . '.log';
$maxStories = 5000;
$maxSingleSource = 0;
$diagnostics = [];
$forceSqliteOverride = false; // Set to true to skip MySQL and always use SQLite

// Get number of stories to return
$numStories = isset($_GET['n']) ? intval($_GET['n']) : $maxStories;
$numStories = max(1, min($maxStories, $numStories));

// Get maximum age in days (default: 0 = unlimited)
$maxAgeDays = isset($_GET['age']) ? max(0.0, floatval($_GET['age'])) : 0.0;
$maxAgeSeconds = $maxAgeDays > 0 ? $maxAgeDays * 86400 : 0;

// Set up error logging
ini_set('log_errors', 1);
ini_set('error_log', '/tmp/rss-php-errors.log');

// Custom error handler to capture all types of errors
set_error_handler(function($errno, $errstr, $errfile, $errline) {
    $message = date('[Y-m-d H:i:s] ') . "Error ($errno): $errstr in $errfile on line $errline\n";
    error_log($message);
    return false; // Let PHP handle the error as well
});

// Register shutdown function to catch fatal errors and return safe JSON
register_shutdown_function(function() {
    $error = error_get_last();
    if ($error && in_array($error['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR])) {
        $message = date('[Y-m-d H:i:s] ') . "FATAL Error: {$error['message']} in {$error['file']} on line {$error['line']}\n";
        error_log($message);

        // Ensure the client receives valid JSON even after a fatal error
        if (ob_get_length()) {
            ob_clean();
        }
        if (!headers_sent()) {
            header('Content-Type: application/json');
        }
        global $outputItemsGlobal;
        $fallbackArray = $outputItemsGlobal ?? [];
        $fallback = json_encode($fallbackArray);
        echo $fallback === false ? '[]' : $fallback;
    }
});

// Load news source configuration to get icons
function loadNewsSourcesFromJson() {
    $jsonFile = __DIR__ . '/../config/news.json';
    if (!file_exists($jsonFile)) {
        logMessage("News feeds JSON file not found: $jsonFile");
        return [];
    }
    
    $jsonContent = file_get_contents($jsonFile);
    if ($jsonContent === false) {
        logMessage("Failed to read news feeds JSON file: $jsonFile");
        return [];
    }
    
    $sources = json_decode($jsonContent, true);
    if ($sources === null) {
        logMessage("Failed to parse news feeds JSON file: $jsonFile");
        return [];
    }
    
    // Extract feeds from structure 
    $feedsData = isset($sources['feeds']) ? $sources['feeds'] : $sources;
    
    // Build a map of feed_id to icon
    $feedIcons = [];
    foreach ($feedsData as $source) {
        if (isset($source['icon'])) {
            $feedIcons[$source['id']] = $source['icon'];
        }
    }
    
    return $feedIcons;
}

// Get database connection
function getDbConnection(&$diagnostics = null, $forceSqliteOverride = false) {
    // Load configuration if available
    try {
        $dotenv = new DotEnv(__DIR__ . '/../.env');
        $_ENV = $dotenv->getAll();
        addDiagnostic($diagnostics, 'Loaded environment configuration');
    } catch (Exception $e) {
        $_ENV = [];
        addDiagnostic($diagnostics, 'No .env configuration loaded: ' . $e->getMessage());
    }
    
    // Try MySQL first if configured and not forced to SQLite
    if (!$forceSqliteOverride && !empty($_ENV['SQL_HOST'])) {
        $host = $_ENV['SQL_HOST'];
        $username = $_ENV['SQL_USER'] ?? '';
        $password = $_ENV['SQL_PASS'] ?? '';
        $dbname = $_ENV['SQL_DB_NAME'] ?? '';
        $dsn = "mysql:host=$host;dbname=$dbname;charset=utf8mb4";
        addDiagnostic($diagnostics, "Attempting MySQL connection to host '{$host}' (DB '{$dbname}')");
        try {
            $pdo = new PDO($dsn, $username, $password);
            $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
            logMessage("Connected to MySQL host '{$host}'");
            addDiagnostic($diagnostics, "Connected to MySQL host '{$host}'");
            return $pdo;
        } catch (PDOException $e) {
            logMessage('MySQL connection failed: ' . $e->getMessage() . ' (falling back to SQLite)');
            addDiagnostic($diagnostics, 'MySQL connection failed: ' . $e->getMessage() . ' (falling back to SQLite)');
        }
    }
    
    // Fall back to SQLite database
    if ($forceSqliteOverride) {
        addDiagnostic($diagnostics, 'FORCE_SQLITE override enabled, using SQLite regardless of SQL_HOST settings');
    }
    $dbPath = $_ENV['SQLITE_PATH'] ?? __DIR__ . '/../news/news_articles.db';
    $dsn = 'sqlite:' . $dbPath;
    addDiagnostic($diagnostics, "Attempting SQLite connection at {$dbPath}");
    try {
        $pdo = new PDO($dsn);
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        logMessage("Connected to SQLite database at {$dbPath}");
        addDiagnostic($diagnostics, "Connected to SQLite database at {$dbPath}");
        return $pdo;
    } catch (PDOException $e) {
        logMessage('SQLite connection failed: ' . $e->getMessage());
        addDiagnostic($diagnostics, 'SQLite connection failed: ' . $e->getMessage());
        return null;
    }
}

// Determine how the endpoint was called
$isPostRequest = $_SERVER['REQUEST_METHOD'] === 'POST';
$requestBody = $isPostRequest ? file_get_contents('php://input') : '';
$hasRequestBody = $isPostRequest && strlen(trim($requestBody)) > 0;
$shouldReturnStats = !$isPostRequest || !$hasRequestBody;

// Check if we're receiving a POST request with included feeds
$includedFeeds = [];
$userHash = '';
if ($isPostRequest && $hasRequestBody) {
    $requestData = json_decode($requestBody, true);
    
    if (json_last_error() !== JSON_ERROR_NONE) {
        logMessage('Invalid JSON in request body: ' . json_last_error_msg());
    } else {
        if (isset($requestData['includedFeeds']) && is_array($requestData['includedFeeds'])) {
            $includedFeeds = $requestData['includedFeeds'];
            logMessage("Received included feeds: " . implode(', ', $includedFeeds));
        }
        
        if (isset($requestData['userHash'])) {
            $candidateHash = sanitizeUserHash($requestData['userHash']);
            if ($candidateHash !== '') {
                $userHash = $candidateHash;
                logMessage("Received hashed user for read filtering");
            } else {
                logMessage('Ignoring invalid userHash provided to news endpoint');
            }
        }
    }
}

// Load feed icons
$feedIcons = loadNewsSourcesFromJson();

// Get database connection
$pdo = getDbConnection($diagnostics, $forceSqliteOverride);
if (!$pdo) {
    logMessage("ERROR: Could not connect to database");
    if ($shouldReturnStats) {
        header('Content-Type: text/plain; charset=UTF-8');
        echo buildPlainTextResponse($diagnostics, ['Database connection unavailable.']);
        ob_end_flush();
        exit;
    } else {
        header('Content-Type: application/json');
        echo json_encode([]);
        ob_end_flush();
        exit;
    }
}

if ($shouldReturnStats) {
    header('Content-Type: text/plain; charset=UTF-8');
    try {
        $statsLines = generateDatabaseStats($pdo, $diagnostics);
        logMessage("Returned database stats");
        echo buildPlainTextResponse($diagnostics, $statsLines);
    } catch (PDOException $e) {
        logMessage("Database stats error: " . $e->getMessage());
        addDiagnostic($diagnostics, 'Database stats error: ' . $e->getMessage());
        echo buildPlainTextResponse($diagnostics, ['Database stats unavailable.']);
    }
    ob_end_flush();
    exit;
}

header('Content-Type: application/json');

// Attempt to load read-history information for this user
$readArticleIds = [];
$readFilterApplied = false;
$readFilterHeader = 'skipped';
if ($userHash !== '') {
    $readDbConnection = getReadStatusDbConnection($diagnostics);
    if ($readDbConnection) {
        $readArticleIds = fetchReadArticleIds($readDbConnection, $userHash, $diagnostics);
        $readFilterApplied = true;
        $readFilterHeader = 'applied';
    } else {
        addDiagnostic($diagnostics, 'Read database connection unavailable; skipping read filtering');
    }
}
header('X-News-Read-Filter: ' . $readFilterHeader);

// Build query to fetch articles
$allItems = [];
$outputItemsGlobal = [];

try {
    // Build WHERE clause for feed and age filtering
    $whereParts = [];
    $params = [];

    if ($maxAgeSeconds > 0) {
        $cutoffTimestamp = time() - $maxAgeSeconds;
        $cutoffDate = date('Y-m-d H:i:s', $cutoffTimestamp);
        $whereParts[] = "published_date >= :cutoff_date";
        $params[':cutoff_date'] = $cutoffDate;
    }
    
    if (!empty($includedFeeds)) {
        $placeholders = [];
        foreach ($includedFeeds as $idx => $feedId) {
            $placeholder = ":feed_$idx";
            $placeholders[] = $placeholder;
            $params[$placeholder] = $feedId;
        }
        $whereParts[] = "feed_id IN (" . implode(', ', $placeholders) . ")";
    }

    $whereClause = '';
    if (!empty($whereParts)) {
        $whereClause = 'WHERE ' . implode(' AND ', $whereParts);
    }
    
    // Query for articles
    $sql = "
        SELECT feed_id, url, title, published_date
        FROM news_articles
        $whereClause
        ORDER BY published_date DESC
        LIMIT :max_stories
    ";
    
    $stmt = $pdo->prepare($sql);
    
    // Bind parameters
    foreach ($params as $key => $value) {
        $stmt->bindValue($key, $value, PDO::PARAM_STR);
    }
    $stmt->bindValue(':max_stories', $maxStories, PDO::PARAM_INT);
    
    $stmt->execute();
    $articles = $stmt->fetchAll(PDO::FETCH_ASSOC);
    
    logMessage("Retrieved " . count($articles) . " articles from database");
    
    // Apply per-feed limits
    $feedCounts = [];
    foreach ($articles as $article) {
        $feedId = $article['feed_id'];
        $articleId = generateArticleId($feedId, $article['title'] ?? '');
        
        // Mark if item was already read (but don't skip it)
        $isRead = $readFilterApplied && isset($readArticleIds[$articleId]);
        
        // Check if we've hit the per-feed limit
        if (!isset($feedCounts[$feedId])) {
            $feedCounts[$feedId] = 0;
        }
        
        if ($maxSingleSource > 0 && $feedCounts[$feedId] >= $maxSingleSource) {
            continue;
        }
        
        $feedCounts[$feedId]++;
        
        // Convert to frontend format
        $pubDate = strtotime($article['published_date']);
        
        $newsItem = [
            'id' => $articleId,
            'title' => $article['title'],
            'link' => $article['url'],
            'date' => $pubDate,
            'source' => $feedId,
            'isRead' => $isRead
        ];
        
        // Add icon if available
        if (isset($feedIcons[$feedId])) {
            $newsItem['icon'] = $feedIcons[$feedId];
        }
        
        $allItems[] = $newsItem;
    }
    
    // Sort items: unread first (by date DESC), then read (by date DESC)
    // Separate into unread and read arrays
    $unreadItems = [];
    $readItems = [];
    foreach ($allItems as $item) {
        if ($item['isRead']) {
            $readItems[] = $item;
        } else {
            $unreadItems[] = $item;
        }
    }
    
    // Sort each group by date (newest first)
    usort($unreadItems, function($a, $b) {
        return $b['date'] - $a['date'];
    });
    usort($readItems, function($a, $b) {
        return $b['date'] - $a['date'];
    });
    
    // Combine: unread first, then read
    $allItems = array_merge($unreadItems, $readItems);
    
    // Limit to requested number of stories
    $outputItems = array_slice($allItems, 0, $numStories);
    
    logMessage("Returning " . count($outputItems) . " articles to client");
    
    // Store for potential shutdown fallback
    $outputItemsGlobal = $outputItems;
    
    // Return JSON
    $jsonOutput = json_encode($outputItems);
    if ($jsonOutput === false) {
        error_log('JSON Encode Error: ' . json_last_error_msg());
        $jsonOutput = '[]';
    }
    echo $jsonOutput;
    
} catch (PDOException $e) {
    logMessage("Database error: " . $e->getMessage());
    echo json_encode([]);
}

ob_end_flush();


// ***** Utility functions *****

// Function to write timestamped log messages to the end of the log file
function logMessage($message) {
    global $logFile;
    file_put_contents($logFile, date('[Y-m-d H:i:s] ') . $message . "\n", FILE_APPEND);
}

// Add a diagnostic line for operators to review from the stats endpoint
function addDiagnostic(&$diagnostics, $message) {
    if (is_array($diagnostics)) {
        $diagnostics[] = $message;
    }
}

// Build a plain-text response that includes diagnostics and payload detail
function buildPlainTextResponse($diagnostics, $payloadLines) {
    $lines = [];
    
    if (!empty($diagnostics)) {
        $lines[] = 'Diagnostics';
        $lines[] = '-----------';
        foreach ($diagnostics as $diag) {
            $lines[] = ' - ' . $diag;
        }
        $lines[] = '';
    }
    
    foreach ($payloadLines as $payloadLine) {
        $lines[] = $payloadLine;
    }
    
    return implode("\n", $lines) . "\n";
}

// Generate a plain-text summary of database stats
function generateDatabaseStats($pdo, &$diagnostics) {
    $lines = [];
    $lines[] = 'News Database Stats';
    $lines[] = '-------------------';
    
    try {
        $summaryStmt = $pdo->query('SELECT COUNT(*) AS total, COUNT(DISTINCT feed_id) AS feeds FROM news_articles');
    } catch (PDOException $e) {
        addDiagnostic($diagnostics, 'Summary query failed: ' . $e->getMessage());
        throw $e;
    }
    $summary = $summaryStmt->fetch(PDO::FETCH_ASSOC) ?: ['total' => 0, 'feeds' => 0];
    $lines[] = 'Total articles: ' . intval($summary['total']);
    $lines[] = 'Distinct feeds: ' . intval($summary['feeds']);
    
    try {
        $latestStmt = $pdo->query('SELECT feed_id, title, published_date FROM news_articles ORDER BY published_date DESC LIMIT 1');
    } catch (PDOException $e) {
        addDiagnostic($diagnostics, 'Latest query failed: ' . $e->getMessage());
        throw $e;
    }
    $latest = $latestStmt->fetch(PDO::FETCH_ASSOC);
    if ($latest) {
        $lines[] = 'Newest article: ' . $latest['published_date'] . ' (' . $latest['feed_id'] . ')';
    } else {
        $lines[] = 'Newest article: n/a';
    }
    
    try {
        $oldestStmt = $pdo->query('SELECT feed_id, title, published_date FROM news_articles ORDER BY published_date ASC LIMIT 1');
    } catch (PDOException $e) {
        addDiagnostic($diagnostics, 'Oldest query failed: ' . $e->getMessage());
        throw $e;
    }
    $oldest = $oldestStmt->fetch(PDO::FETCH_ASSOC);
    if ($oldest) {
        $lines[] = 'Oldest article: ' . $oldest['published_date'] . ' (' . $oldest['feed_id'] . ')';
    } else {
        $lines[] = 'Oldest article: n/a';
    }
    
    $lines[] = '';
    $lines[] = 'Counts by feed:';
    try {
        $perFeedStmt = $pdo->query('SELECT feed_id, COUNT(*) AS item_count, MAX(published_date) AS latest FROM news_articles GROUP BY feed_id ORDER BY item_count DESC, feed_id ASC');
    } catch (PDOException $e) {
        addDiagnostic($diagnostics, 'Per-feed query failed: ' . $e->getMessage());
        throw $e;
    }
    $perFeed = $perFeedStmt->fetchAll(PDO::FETCH_ASSOC);
    if (empty($perFeed)) {
        $lines[] = '  (no feed data)';
    } else {
        foreach ($perFeed as $row) {
            $lines[] = sprintf(
                '  %s: %d (latest %s)',
                $row['feed_id'],
                $row['item_count'],
                $row['latest']
            );
        }
    }
    
    return $lines;
}

/**
 * Validate and sanitize the user hash provided by the client.
 */
function sanitizeUserHash($userHash) {
    if (!is_string($userHash)) {
        return '';
    }
    
    $userHash = trim($userHash);
    if ($userHash === '') {
        return '';
    }
    
    $length = strlen($userHash);
    if ($length < 8 || $length > 255) {
        return '';
    }
    
    if (!preg_match('/^[A-Za-z0-9_-]+$/', $userHash)) {
        return '';
    }
    
    return $userHash;
}

/**
 * Open a connection to the REST key/value database that tracks read articles.
 */
function getReadStatusDbConnection(&$diagnostics) {
    global $_ENV;
    
    // Attempt MySQL if configured
    if (!empty($_ENV['SQL_HOST'])) {
        $host = $_ENV['SQL_HOST'];
        $username = $_ENV['SQL_USER'] ?? '';
        $password = $_ENV['SQL_PASS'] ?? '';
        $dbname = $_ENV['SQL_DB_NAME'] ?? '';
        $dsn = "mysql:host=$host;dbname=$dbname;charset=utf8mb4";
        addDiagnostic($diagnostics, "Attempting read-status MySQL connection to host '{$host}'");
        
        try {
            $pdo = new PDO($dsn, $username, $password);
            $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
            addDiagnostic($diagnostics, "Connected to read-status MySQL host '{$host}'");
            return $pdo;
        } catch (PDOException $e) {
            logMessage('Read-status MySQL connection failed: ' . $e->getMessage());
            addDiagnostic($diagnostics, 'Read-status MySQL connection failed: ' . $e->getMessage());
        }
    }
    
    // Fallback to SQLite path (use dedicated path if provided)
    $dbPath = $_ENV['RESTDB_SQLITE_PATH'] ?? (sys_get_temp_dir() . '/restdb.sqlite');
    $dsn = 'sqlite:' . $dbPath;
    addDiagnostic($diagnostics, "Attempting read-status SQLite connection at {$dbPath}");
    
    try {
        $pdo = new PDO($dsn);
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        addDiagnostic($diagnostics, "Connected to read-status SQLite database at {$dbPath}");
        return $pdo;
    } catch (PDOException $e) {
        logMessage('Read-status SQLite connection failed: ' . $e->getMessage());
        addDiagnostic($diagnostics, 'Read-status SQLite connection failed: ' . $e->getMessage());
        return null;
    }
}

/**
 * Fetch all read article IDs for a given user hash.
 */
function fetchReadArticleIds($pdo, $userHash, &$diagnostics) {
    $ids = [];
    
    try {
        $stmt = $pdo->prepare("
            SELECT `key`, `value`, `life_time`, `created_at`
            FROM key_value
            WHERE (`key` = :user_key OR `key` LIKE :user_prefix)
        ");
        $stmt->execute([
            ':user_key' => $userHash,
            ':user_prefix' => $userHash . '/%'
        ]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    } catch (PDOException $e) {
        logMessage('Failed to query read-status database: ' . $e->getMessage());
        addDiagnostic($diagnostics, 'Read-status query failed: ' . $e->getMessage());
        return $ids;
    }
    
    $now = time();
    $expiredKeys = [];
    
    foreach ($rows as $row) {
        // Skip directories or malformed records
        if (!isset($row['value']) || $row['value'] === null) {
            continue;
        }
        
        // Enforce expiration in the same way as rest_db.php
        $createdAt = isset($row['created_at']) ? strtotime($row['created_at']) : 0;
        $lifeTimeDays = isset($row['life_time']) ? (float)$row['life_time'] : 2.0;
        $expiresAt = ($createdAt > 0 && $lifeTimeDays > 0)
            ? ($createdAt + (int)($lifeTimeDays * 86400))
            : 0;
        
        if ($expiresAt > 0 && $now > $expiresAt) {
            $expiredKeys[] = $row['key'];
            continue;
        }
        
        $segments = explode('/', $row['key']);
        $articleId = end($segments);
        if ($articleId === false || $articleId === '' || $articleId === $userHash) {
            continue;
        }
        
        $ids[$articleId] = true;
    }
    
    if (!empty($expiredKeys)) {
        try {
            $placeholders = implode(',', array_fill(0, count($expiredKeys), '?'));
            $deleteStmt = $pdo->prepare("DELETE FROM key_value WHERE `key` IN ($placeholders)");
            $deleteStmt->execute($expiredKeys);
        } catch (PDOException $e) {
            logMessage('Failed to prune expired read-status keys: ' . $e->getMessage());
        }
    }
    
    addDiagnostic($diagnostics, 'Loaded ' . count($ids) . ' read IDs for user ' . $userHash);
    return $ids;
}

/**
 * Generate the same article ID that the frontend uses so we can cross-check read status.
 */
function generateArticleId($sourceId, $title) {
    $dataToHash = (string)$sourceId . (string)$title;
    if ($dataToHash === '') {
        return '0';
    }
    
    $utf16 = convertToUtf16Be($dataToHash);
    $length = strlen($utf16);
    if ($length === 0) {
        return '0';
    }
    
    $hash = 0;
    for ($i = 0; $i < $length; $i += 2) {
        $byte1 = ord($utf16[$i]);
        $byte2 = ($i + 1 < $length) ? ord($utf16[$i + 1]) : 0;
        $charCode = ($byte1 << 8) + $byte2;
        $hash = toSigned32((($hash << 5) - $hash) + $charCode);
    }
    
    $hexHash = strtolower(dechex(abs($hash)));
    if ($hexHash === '') {
        $hexHash = '0';
    }
    
    return strlen($hexHash) > 16 ? substr($hexHash, 0, 16) : $hexHash;
}

/**
 * Convert an integer to signed 32-bit representation.
 */
function toSigned32($value) {
    $value = $value & 0xFFFFFFFF;
    if ($value & 0x80000000) {
        $value -= 0x100000000;
    }
    return $value;
}

/**
 * Convert a UTF-8 string into UTF-16BE bytes to mirror JavaScript charCodeAt behavior.
 */
function convertToUtf16Be($input) {
    if (function_exists('mb_convert_encoding')) {
        $converted = @mb_convert_encoding($input, 'UTF-16BE', 'UTF-8');
        if ($converted !== false) {
            return $converted;
        }
    }
    
    if (function_exists('iconv')) {
        $converted = @iconv('UTF-8', 'UTF-16BE//IGNORE', $input);
        if ($converted !== false) {
            return $converted;
        }
    }
    
    // Last-resort fallback: treat original string as UTF-8 bytes
    return $input;
}
