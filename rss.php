<?php

// Settings
$cacheDuration = 300; // 5 minutes
$cacheFile = '/tmp/rss_cache.json';
$cacheTimestampFile = '/tmp/rss_cache_timestamp';
$logFile = '/tmp/rss_php.log';
$maxStories = 64; // Maximum number of stories to return
$maxSingleSource = 7; // Maximum number of stories from a single source

// List of RSS feeds to fetch
$feeds = [
    'wsj' => 'https://feeds.content.dowjones.io/public/rss/RSSWorldNews',
    'nyt' => 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml',
    'bbc' => 'http://feeds.bbci.co.uk/news/world/rss.xml',
    'wapo' => 'https://feeds.washingtonpost.com/rss/national',
    'latimes' => 'https://www.latimes.com/business/rss2.0.xml',
    'bos' => 'https://www.boston.com/tag/local-news/feed',
    'bloomberg' => 'https://feeds.bloomberg.com/news.rss',
    'bloomberg-tech' => 'https://feeds.bloomberg.com/technology/news.rss',
    'notateslaapp' => 'https://www.notateslaapp.com/rss',
    'teslarati' => 'https://www.teslarati.com/feed/',
    'insideevs' => 'https://insideevs.com/rss/articles/all/',
    'electrek' => 'https://electrek.co/feed/',
    'thedrive' => 'https://www.thedrive.com/feed',
    'techcrunch' => 'https://techcrunch.com/feed/',
    'theverge' => 'https://www.theverge.com/rss/index.xml',
    'jalopnik' => 'https://jalopnik.com/rss',
];

// Check if we're in test mode
$testMode = isset($_GET['test']);

// If in test mode, return fake news items with timestamps 1-5 seconds ago
if ($testMode) {
    header('Content-Type: application/json');
    
    $testItems = [];
    $now = time();
    
    // Test sources for variety
    $testSources = ['testnews', 'testlert', 'testrati', 'insidetest', 'testrek'];
    
    // Generate 5 fake news items with timestamps from 1-5 seconds ago
    for ($i = 1; $i <= 5; $i++) {
        $testItems[] = [
            'title' => "Test Breaking News Headline #$i - " . date('H:i:s'),
            'link' => "https://example.com/news/$i",
            'date' => $now - $i, // 1 to 5 seconds ago
            'source' => $testSources[$i-1]
        ];
    }
    
    echo json_encode($testItems);
    exit;
}

// Set up error logging - clear log file on each run
file_put_contents('/tmp/rss-php-errors.log', ''); // Empty the file
ini_set('log_errors', 1);
ini_set('error_log', '/tmp/rss-php-errors.log');

// Custom error handler to capture all types of errors
set_error_handler(function($errno, $errstr, $errfile, $errline) {
    $message = date('[Y-m-d H:i:s] ') . "Error ($errno): $errstr in $errfile on line $errline\n";
    error_log($message);
    return false; // Let PHP handle the error as well
});

// Register shutdown function to catch fatal errors
register_shutdown_function(function() {
    $error = error_get_last();
    if ($error && in_array($error['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR])) {
        $message = date('[Y-m-d H:i:s] ') . "FATAL Error: {$error['message']} in {$error['file']} on line {$error['line']}\n";
        error_log($message);
    }
});

// Create empty log file
file_put_contents($logFile, 'rss.php started...' . "\n");

// Set the content type and add headers to prevent caching
header('Cache-Control: no-cache, no-store, must-revalidate');
header('Pragma: no-cache');
header('Expires: 0');
header('Content-Type: application/json');

// Check if we're receiving a POST request with excluded feeds
$excludedFeeds = [];
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    // Get the request body
    $requestBody = file_get_contents('php://input');
    $requestData = json_decode($requestBody, true);
    
    // Check if excludedFeeds is set in the request
    if (isset($requestData['excludedFeeds']) && is_array($requestData['excludedFeeds'])) {
        $excludedFeeds = $requestData['excludedFeeds'];
        logMessage("Received excluded feeds: " . implode(', ', $excludedFeeds));
    }
}

// Check if reload parameter is set to bypass cache
$forceReload = isset($_GET['reload']) || isset($_GET['n']);

// Get number of stories to return
$numStories = isset($_GET['n']) ? intval($_GET['n']) : $maxStories;
$numStories = max(1, min(128, $numStories));

// Check if cache exists and is fresh (unless forced reload is requested)
if (!$forceReload && file_exists($cacheFile) && file_exists($cacheTimestampFile)) {
    $timestamp = file_get_contents($cacheTimestampFile);
    if ((time() - $timestamp) < $cacheDuration) {
        // Cache is still fresh, return cached content
        echo file_get_contents($cacheFile);
        exit;
    }
}

// If cache is stale or missing, proceed to fetch new RSS feeds...

// Function to write timestamped log messages to the end of the log file
function logMessage($message) {
    global $logFile;
    file_put_contents($logFile, date('[Y-m-d H:i:s] ') . $message . "\n", FILE_APPEND);
}

function fetchRSS($url) {
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 10);
    curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (compatible; RSS Reader/1.0)');
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    $response = curl_exec($ch);
    
    if (curl_errno($ch)) {
        error_log("RSS Feed Error: " . curl_error($ch) . " - URL: " . $url);
        curl_close($ch);
        return false;
    }
    
    curl_close($ch);
    return $response;
}

function parseRSS($xml, $source) {
    global $maxSingleSource;

    try {
        $feed = simplexml_load_string($xml);
        if (!$feed) {
            error_log("RSS Parse Error: Failed to parse XML feed from source: {$source}");
            return [];
        }
    } catch (Exception $e) {
        error_log("RSS Parse Exception for source {$source}: " . $e->getMessage());
        return [];
    }

    $items = [];
    
    // Handle different RSS feed structures
    $feedItems = null;
    if (isset($feed->channel) && isset($feed->channel->item)) {
        $feedItems = $feed->channel->item;  // Standard RSS format
    } elseif (isset($feed->entry)) {
        $feedItems = $feed->entry;  // Atom format
    } elseif (isset($feed->item)) {
        $feedItems = $feed->item;   // Some non-standard RSS variants
    }
    
    if (!$feedItems) return [];
    
    foreach ($feedItems as $item) {
        // Try to find the publication date in various formats
        $pubDate = null;
        $dateString = null;
        
        // Check for different date fields
        if (isset($item->pubDate)) {
            $dateString = (string)$item->pubDate;
        } elseif (isset($item->published)) {
            $dateString = (string)$item->published;
        } elseif (isset($item->updated)) {
            $dateString = (string)$item->updated;
        } elseif (isset($item->children('dc', true)->date)) {
            $dateString = (string)$item->children('dc', true)->date;
        }
        
        if ($dateString) {
            // Try to parse the date
            $pubDate = strtotime($dateString);
            
            // If parsing failed, try to reformat common date patterns
            if ($pubDate === false) {
                // Try ISO 8601 format (remove milliseconds if present)
                if (preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/', $dateString)) {
                    $cleaned = preg_replace('/\.\d+/', '', $dateString);
                    $pubDate = strtotime($cleaned);
                }
                
                // Try common RFC formats with missing timezone
                if ($pubDate === false && preg_match('/^\w+, \d+ \w+ \d+$/', $dateString)) {
                    $pubDate = strtotime($dateString . " 00:00:00 +0000");
                }
                
                // Last resort: use current time
                if ($pubDate === false) {
                    error_log("Failed to parse date: {$dateString} from source: {$source}");
                    $pubDate = time();
                }
            }
        } else {
            // If no date is found, use current time (FIX: bad idea)
            $pubDate = time();
        }
        
        // Find the link (which could be in different formats)
        $link = "";
        if (isset($item->link)) {
            if (is_object($item->link) && isset($item->link['href'])) {
                $link = (string)$item->link['href']; // Atom format
            } else {
                $link = (string)$item->link; // RSS format
            }
        }
        
        // Find the title
        $title = isset($item->title) ? (string)$item->title : "No Title";
        
        $items[] = [
            'title' => $title,
            'link' => $link,
            'date' => $pubDate,
            'source' => $source
        ];

        // Limit number from single source
        if (count($items) > $maxSingleSource) {
            logMessage("Limiting number of stories from source: {$source}");
            break;
        }
    }
    logMessage("Fetched " . count($items) . " stories from source: {$source}");
    return $items;
}

$allItems = [];
foreach ($feeds as $source => $url) {
    $xml = fetchRSS($url);
    if ($xml !== false) {
        $items = parseRSS($xml, $source);
        $allItems = array_merge($allItems, $items);
    }
}

// Sort by date, newest first
usort($allItems, function($a, $b) {
    return $b['date'] - $a['date'];
});

// Keep only the most recent items
$allItems = array_slice($allItems, 0, $numStories);

// Cache the results - the cache contains ALL items (for all users)
file_put_contents($cacheFile, json_encode($allItems));
file_put_contents($cacheTimestampFile, time());

// Filter out excluded feeds as the final step (after caching)
if (!empty($excludedFeeds)) {
    logMessage("Filtering out excluded feeds: " . implode(', ', $excludedFeeds));
    $allItems = array_filter($allItems, function($item) use ($excludedFeeds) {
        return !in_array($item['source'], $excludedFeeds);
    });
    // Re-index array after filtering
    $allItems = array_values($allItems);
    logMessage("After filtering: " . count($allItems) . " items remain");
}

echo json_encode($allItems);
