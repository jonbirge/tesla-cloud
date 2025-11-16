<?php

// Include required files
require_once __DIR__ . '/git_info.php';
require_once 'dotenv.php';

// Set the content type and add headers to prevent caching
header('Cache-Control: no-cache, no-store, must-revalidate');
header('Expires: 0');
header('Content-Type: application/json');

// Buffer output so we can return well-formed JSON even if a fatal error occurs
ob_start();

// Get version information
$gitInfo = getGitInfo();
$version = isset($gitInfo['commit']) ? $gitInfo['commit'] : 'unknown';

// Settings
$logFile = '/tmp/news_php_' . $version . '.log';
$maxStories = 512;

// Get number of stories to return
$numStories = isset($_GET['n']) ? intval($_GET['n']) : $maxStories;
$numStories = max(1, min($maxStories, $numStories));

// Get maximum age in days (default: 2 days)
$maxAgeDays = isset($_GET['age']) ? floatval($_GET['age']) : 2.0;
$maxAgeSeconds = $maxAgeDays * 86400; // Convert days to seconds
$cutoffTimestamp = time() - $maxAgeSeconds;

// Load news feed configurations to get icons
function loadNewsSourcesFromJson() {
    $jsonFile = __DIR__ . '/../json/news-feeds.json';
    if (!file_exists($jsonFile)) {
        return [];
    }
    
    $jsonContent = file_get_contents($jsonFile);
    if ($jsonContent === false) {
        return [];
    }
    
    $sources = json_decode($jsonContent, true);
    if ($sources === null) {
        return [];
    }
    
    // Extract feeds from new structure 
    $feedsData = isset($sources['feeds']) ? $sources['feeds'] : $sources;
    
    // Convert to lookup table by ID
    $feeds = [];
    foreach ($feedsData as $source) {
        $feeds[$source['id']] = $source;
    }
    
    return $feeds;
}

$feedConfigs = loadNewsSourcesFromJson();

// Set up error logging
ini_set('log_errors', 1);
ini_set('error_log', '/tmp/news-php-errors.log');

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
        echo '[]';
    }
});

// Check if we're receiving a POST request with included feeds
$includedFeeds = [];
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    // Get the request body
    $requestBody = file_get_contents('php://input');
    $requestData = json_decode($requestBody, true);
    
    // Check if includedFeeds is set in the request
    if (isset($requestData['includedFeeds']) && is_array($requestData['includedFeeds'])) {
        $includedFeeds = $requestData['includedFeeds'];
        logMessage("Received included feeds: " . implode(', ', $includedFeeds));
    }
}

// Load configuration for database connection
try {
    $dotenv = new DotEnv(__DIR__ . '/../.env');
    $_ENV = $dotenv->getAll();
} catch (Exception $e) {
    $_ENV = [];
}

// Connect to database
try {
    if (isset($_ENV['SQL_HOST'])) {
        // Use MySQL/MariaDB credentials from .env
        $host = $_ENV['SQL_HOST'];
        $username = $_ENV['SQL_USER'];
        $password = $_ENV['SQL_PASS'];
        $dbname = $_ENV['SQL_DB_NAME'];
        $dsn = "mysql:host=$host;dbname=$dbname";
        $pdo = new PDO($dsn, $username, $password);
    } else {
        // Fall back to SQLite database
        $dbPath = isset($_ENV['SQLITE_PATH']) ? $_ENV['SQLITE_PATH'] : '/tmp/news.db';
        $dsn = 'sqlite:' . $dbPath;
        $pdo = new PDO($dsn);
    }

    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
} catch (PDOException $e) {
    logMessage("Database connection failed: " . $e->getMessage());
    echo json_encode([]);
    ob_end_flush();
    exit;
}

// Build SQL query based on included feeds
try {
    $sql = "SELECT feed_name, url, title, published_date 
            FROM news_articles 
            WHERE published_date >= :cutoff";
    
    $params = [':cutoff' => $cutoffTimestamp];
    
    // Add feed filter if specified
    if (!empty($includedFeeds)) {
        $placeholders = [];
        foreach ($includedFeeds as $index => $feedName) {
            $placeholder = ":feed$index";
            $placeholders[] = $placeholder;
            $params[$placeholder] = $feedName;
        }
        $sql .= " AND feed_name IN (" . implode(',', $placeholders) . ")";
    }
    
    $sql .= " ORDER BY published_date DESC LIMIT :limit";
    $params[':limit'] = $numStories;
    
    $stmt = $pdo->prepare($sql);
    
    // Bind parameters
    foreach ($params as $key => $value) {
        if ($key === ':limit' || $key === ':cutoff') {
            $stmt->bindValue($key, $value, PDO::PARAM_INT);
        } else {
            $stmt->bindValue($key, $value, PDO::PARAM_STR);
        }
    }
    
    $stmt->execute();
    $articles = $stmt->fetchAll(PDO::FETCH_ASSOC);
    
    logMessage("Retrieved " . count($articles) . " articles from database");
    
    // Format articles for frontend
    $outputItems = [];
    foreach ($articles as $article) {
        $feedId = $article['feed_name'];
        
        $item = [
            'title' => $article['title'],
            'link' => $article['url'],
            'date' => (int)$article['published_date'],
            'source' => $feedId
        ];
        
        // Add icon if available in feed config
        if (isset($feedConfigs[$feedId]['icon'])) {
            $item['icon'] = $feedConfigs[$feedId]['icon'];
        }
        
        $outputItems[] = $item;
    }
    
    // Return the articles as JSON
    $jsonOutput = json_encode($outputItems);
    if ($jsonOutput === false) {
        error_log('JSON Encode Error: ' . json_last_error_msg());
        $jsonOutput = '[]';
    }
    echo $jsonOutput;
    
} catch (PDOException $e) {
    logMessage("Database query failed: " . $e->getMessage());
    echo json_encode([]);
}

ob_end_flush();

// ***** Utility functions *****

// Function to write timestamped log messages
function logMessage($message) {
    global $logFile;
    file_put_contents($logFile, date('[Y-m-d H:i:s] ') . $message . "\n", FILE_APPEND);
}
