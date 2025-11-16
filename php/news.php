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
$maxStories = 512;
$maxSingleSource = 32;
$diagnostics = [];
$forceSqliteOverride = true; // Set to true to skip MySQL and always use SQLite

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
    $dbPath = $_ENV['SQLITE_PATH'] ?? __DIR__ . '/../news_articles.db';
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
if ($isPostRequest && $hasRequestBody) {
    $requestData = json_decode($requestBody, true);
    
    if (json_last_error() !== JSON_ERROR_NONE) {
        logMessage('Invalid JSON in request body: ' . json_last_error_msg());
    } elseif (isset($requestData['includedFeeds']) && is_array($requestData['includedFeeds'])) {
        $includedFeeds = $requestData['includedFeeds'];
        logMessage("Received included feeds: " . implode(', ', $includedFeeds));
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
        
        // Check if we've hit the per-feed limit
        if (!isset($feedCounts[$feedId])) {
            $feedCounts[$feedId] = 0;
        }
        
        if ($feedCounts[$feedId] >= $maxSingleSource) {
            continue;
        }
        
        $feedCounts[$feedId]++;
        
        // Convert to frontend format
        $pubDate = strtotime($article['published_date']);
        
        $newsItem = [
            'title' => $article['title'],
            'link' => $article['url'],
            'date' => $pubDate,
            'source' => $feedId
        ];
        
        // Add icon if available
        if (isset($feedIcons[$feedId])) {
            $newsItem['icon'] = $feedIcons[$feedId];
        }
        
        $allItems[] = $newsItem;
    }
    
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
