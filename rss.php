<?php
// Include the git info function
require_once __DIR__ . '/git_info.php';

// Get version information directly using the function
$gitInfo = getGitInfo();
$version = isset($gitInfo['commit']) ? $gitInfo['commit'] : 'unknown';

// Settings
$cacheDuration = 600; // 10 minutes
$cacheFile = '/tmp/rss_cache_' . $version . '.json';
$cacheTimestampFile = '/tmp/rss_cache_timestamp_' . $version;
$logFile = '/tmp/rss_php_' . $version . '.log';
$maxStories = 128; // Maximum number of stories to send to client
$maxSingleSource = 9; // Maximum number of stories to keep from a single source

// List of RSS feeds to fetch
$feeds = [
    'wsj' => 'https://feeds.content.dowjones.io/public/rss/RSSWorldNews',
    'nyt' => 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml',
    'wapo' => 'https://feeds.washingtonpost.com/rss/national',
    'latimes' => 'https://www.latimes.com/business/rss2.0.xml',
    'bos' => 'https://www.boston.com/tag/local-news/feed',
    'bloomberg' => 'https://feeds.bloomberg.com/news.rss',
    'bloomberg-tech' => 'https://feeds.bloomberg.com/technology/news.rss',
    'bbc' => 'http://feeds.bbci.co.uk/news/world/rss.xml',
    'telegraph' => 'https://www.telegraph.co.uk/news/rss.xml',
    'economist' => 'https://www.economist.com/latest/rss.xml',
    'lemonde' => 'https://www.lemonde.fr/rss/une.xml',
    'derspiegel' => 'https://www.spiegel.de/international/index.rss',
    'notateslaapp' => 'https://www.notateslaapp.com/rss',
    'teslarati' => 'https://www.teslarati.com/feed/',
    'insideevs' => 'https://insideevs.com/rss/articles/all/',
    'electrek' => 'https://electrek.co/feed/',
    'thedrive' => 'https://www.thedrive.com/feed',
    'jalopnik' => 'https://jalopnik.com/rss',
    'arstechnica' => 'https://feeds.arstechnica.com/arstechnica/index',
    'engadget' => 'https://www.engadget.com/rss.xml',
    'gizmodo' => 'https://gizmodo.com/rss',
    'theverge' => 'https://www.theverge.com/rss/index.xml',
    'defensenews' => 'https://www.defensenews.com/arc/outboundfeeds/rss/?outputType=xml'
];

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

// Check if serial fetching is requested
$useSerialFetch = isset($_GET['serial']);

// Get number of stories to return
$numStories = isset($_GET['n']) ? intval($_GET['n']) : $maxStories;
$numStories = max(1, min($maxStories, $numStories));

// Cache logic
if (!$forceReload && file_exists($cacheFile) && file_exists($cacheTimestampFile)) {
    $timestamp = file_get_contents($cacheTimestampFile);
    if ((time() - $timestamp) < $cacheDuration) {
        logMessage("Using cached data, last updated: " . date('Y-m-d H:i:s', $timestamp));
        $useCache = true;
    } else {
        logMessage("Cache expired, fetching new data...");
        $useCache = false;
    }
} else {
    logMessage("Cache not found or expired, fetching new data...");
    $useCache = false;
}

// Get items from cache or from external sources
$allItems = [];
if ($useCache) {
    $allItems = json_decode(file_get_contents($cacheFile), true);
} else {    
    if ($useSerialFetch) {
        // Serial fetching mode
        foreach ($feeds as $source => $url) {
            $xml = fetchRSS($url);
            if ($xml !== false) {
                $items = parseRSS($xml, $source);
                $allItems = array_merge($allItems, $items);
            }
        }
    } else {
        // Parallel fetching mode (default)
        $feedResults = fetchRSSParallel($feeds);
        
        // Process the results
        foreach ($feedResults as $source => $xml) {
            if ($xml !== false) {
                $items = parseRSS($xml, $source);
                $allItems = array_merge($allItems, $items);
            }
        }
    }
    
    // Sort by date, newest first
    usort($allItems, function($a, $b) {
        return $b['date'] - $a['date'];
    });

    // Cache the results - the cache contains ALL items
    file_put_contents($cacheFile, json_encode($allItems));
    file_put_contents($cacheTimestampFile, time());
}

// Apply exclusion filters to cached data
$outputItems = applyExclusionFilters($allItems, $excludedFeeds);
    
// Limit number of stories if needed
$outputItems = array_slice($outputItems, 0, $numStories);

// Return filtered cached content
echo json_encode($outputItems);


// ***** Utility functions *****

function fetchRSSParallel($feedUrls) {
    $multiHandle = curl_multi_init();
    $curlHandles = [];
    $results = [];
    
    // Initialize all curl handles and add them to multi handle
    foreach ($feedUrls as $source => $url) {
        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 10);
        curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (compatible; RSS Reader/1.0)');
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
        curl_setopt($ch, CURLOPT_PRIVATE, $source); // Store the source as private data
        
        curl_multi_add_handle($multiHandle, $ch);
        $curlHandles[] = $ch;
        $results[$source] = false; // Initialize with false for error checking later
    }
    
    // Execute all queries simultaneously
    $active = null;
    do {
        $mrc = curl_multi_exec($multiHandle, $active);
    } while ($mrc == CURLM_CALL_MULTI_PERFORM);
    
    while ($active && $mrc == CURLM_OK) {
        if (curl_multi_select($multiHandle) != -1) {
            do {
                $mrc = curl_multi_exec($multiHandle, $active);
            } while ($mrc == CURLM_CALL_MULTI_PERFORM);
        }
    }
    
    // Process the results
    foreach ($curlHandles as $ch) {
        $source = curl_getinfo($ch, CURLINFO_PRIVATE);
        $content = curl_multi_getcontent($ch);
        
        if (curl_errno($ch)) {
            error_log("RSS Feed Error: " . curl_error($ch) . " - URL: " . $feedUrls[$source]);
        } else {
            $results[$source] = $content;
        }
        
        curl_multi_remove_handle($multiHandle, $ch);
        curl_close($ch);
    }
    
    curl_multi_close($multiHandle);
    return $results;
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

// Function to apply exclusion filters to items
function applyExclusionFilters($items, $excludedFeeds) {
    if (empty($excludedFeeds)) {
        return $items;
    }
    
    logMessage("Filtering out excluded feeds: " . implode(', ', $excludedFeeds));
    $filteredItems = array_filter($items, function($item) use ($excludedFeeds) {
        return !in_array($item['source'], $excludedFeeds);
    });
    
    // Re-index array after filtering
    $filteredItems = array_values($filteredItems);
    logMessage("After filtering: " . count($filteredItems) . " items remain");
    
    return $filteredItems;
}

// Function to write timestamped log messages to the end of the log file
function logMessage($message) {
    global $logFile;
    file_put_contents($logFile, date('[Y-m-d H:i:s] ') . $message . "\n", FILE_APPEND);
}
