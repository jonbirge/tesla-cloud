<?php
// Include the git info function
require_once __DIR__ . '/git_info.php';

// Get version information directly using the function
// TODO: Remove this once deployment is containerized
$gitInfo = getGitInfo();
$version = isset($gitInfo['commit']) ? $gitInfo['commit'] : 'unknown';

// Check if reload parameter is set to bypass cache
$forceReload = isset($_GET['reload']);

// Check if serial fetching is requested
$useSerialFetch = isset($_GET['serial']);

// Settings
$defaultCacheDuration = 10; // Default cache duration in minutes
$cacheFile = '/tmp/rss_cache_' . $version . '.json';
$cacheTimestampFile = '/tmp/rss_cache_timestamp_' . $version . '.json';
$logFile = '/tmp/rss_php_' . $version . '.log';
$maxStories = 512; // Maximum number of stories to send to client
$maxSingleSource = 32; // Maximum number of stories to keep from a single source

// Get number of stories to return
$numStories = isset($_GET['n']) ? intval($_GET['n']) : $maxStories;
$numStories = max(1, min($maxStories, $numStories));

// List of RSS feeds to fetch - now with individual cache durations in minutes
$feeds = [
    'wsj' => ['url' => 'https://feeds.content.dowjones.io/public/rss/RSSWorldNews', 'cache' => 15],
    'nyt' => ['url' => 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml', 'cache' => 10],
    'wapo' => ['url' => 'https://feeds.washingtonpost.com/rss/national', 'cache' => 10],
    'latimes' => ['url' => 'https://www.latimes.com/rss2.0.xml', 'cache' => 15],
    'bos' => ['url' => 'https://www.boston.com/tag/local-news/feed', 'cache' => 20],
    'den' => ['url' => 'https://www.denverpost.com/feed/', 'cache' => 20],
    'bloomberg' => ['url' => 'https://feeds.bloomberg.com/news.rss', 'cache' => 10],
    'bloomberg-tech' => ['url' => 'https://feeds.bloomberg.com/technology/news.rss', 'cache' => 15],
    'economist' => ['url' => 'https://www.economist.com/latest/rss.xml', 'cache' => 60],
    'bbc' => ['url' => 'http://feeds.bbci.co.uk/news/world/rss.xml', 'cache' => 10],
    'lemonde' => ['url' => 'https://www.lemonde.fr/rss/une.xml', 'cache' => 20],
    'derspiegel' => ['url' => 'https://www.spiegel.de/international/index.rss', 'cache' => 30],
    'notateslaapp' => ['url' => 'https://www.notateslaapp.com/rss', 'cache' => 30],
    'teslarati' => ['url' => 'https://www.teslarati.com/feed/', 'cache' => 15],
    'insideevs' => ['url' => 'https://insideevs.com/rss/articles/all/', 'cache' => 15],
    'electrek' => ['url' => 'https://electrek.co/feed/', 'cache' => 15],
    'thedrive' => ['url' => 'https://www.thedrive.com/feed', 'cache' => 20],
    'jalopnik' => ['url' => 'https://jalopnik.com/rss', 'cache' => 20],
    'caranddriver' => ['url' => 'https://www.caranddriver.com/rss/all.xml/', 'cache' => 30],
    'techcrunch' => ['url' => 'https://techcrunch.com/feed/', 'cache' => 15],
    'arstechnica' => ['url' => 'https://feeds.arstechnica.com/arstechnica/index', 'cache' => 15],
    'engadget' => ['url' => 'https://www.engadget.com/rss.xml', 'cache' => 15],
    'gizmodo' => ['url' => 'https://gizmodo.com/rss', 'cache' => 15],
    'theverge' => ['url' => 'https://www.theverge.com/rss/index.xml', 'cache' => 15],
    'wired' => ['url' => 'https://www.wired.com/feed/rss', 'cache' => 20],
    'spacenews' => ['url' => 'https://spacenews.com/feed/', 'cache' => 30],
    'defensenews' => ['url' => 'https://www.defensenews.com/arc/outboundfeeds/rss/?outputType=xml', 'cache' => 60]
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

// Load timestamp data if it exists
$feedTimestamps = [];
if (file_exists($cacheTimestampFile)) {
    $feedTimestamps = json_decode(file_get_contents($cacheTimestampFile), true);
    if (!is_array($feedTimestamps)) {
        $feedTimestamps = []; // Reset if invalid format
    }
}

// Get items from cache or from external sources
$allItems = [];
$needsCaching = false;

// Load cached data if it exists
$cachedItems = [];
if (file_exists($cacheFile)) {
    $cachedItems = json_decode(file_get_contents($cacheFile), true);
    if (!is_array($cachedItems)) {
        $cachedItems = []; // Reset if invalid format
    }
}

// Group cached items by source
$itemsBySource = [];
foreach ($cachedItems as $item) {
    $source = $item['source'];
    if (!isset($itemsBySource[$source])) {
        $itemsBySource[$source] = [];
    }
    $itemsBySource[$source][] = $item;
}

// Determine which feeds need to be refreshed
$feedsToFetch = [];
$currentTime = time();

foreach ($feeds as $source => $feedData) {
    $cacheDurationSeconds = $feedData['cache'] * 60; // Convert minutes to seconds
    $lastUpdated = isset($feedTimestamps[$source]) ? $feedTimestamps[$source] : 0;
    
    if ($forceReload || ($currentTime - $lastUpdated) > $cacheDurationSeconds) {
        // Cache expired or force reload requested
        $feedsToFetch[$source] = $feedData['url'];
        $needsCaching = true;
        logMessage("Cache expired for $source, fetching new data...");
    } else {
        // Use cached data
        logMessage("Using cached data for $source, last updated: " . date('Y-m-d H:i:s', $lastUpdated));
        if (isset($itemsBySource[$source])) {
            $allItems = array_merge($allItems, $itemsBySource[$source]);
        }
    }
}

// Fetch feeds that need updating
if (!empty($feedsToFetch)) {
    if ($useSerialFetch) {
        // Serial fetching mode
        foreach ($feedsToFetch as $source => $url) {
            $xml = fetchRSS($url);
            if ($xml !== false) {
                $items = parseRSS($xml, $source);
                $allItems = array_merge($allItems, $items);
                
                // Update timestamp for this feed
                $feedTimestamps[$source] = $currentTime;
            }
        }
    } else {
        // Parallel fetching mode (default)
        $feedResults = fetchRSSParallel($feedsToFetch);
        
        // Process the results
        foreach ($feedResults as $source => $xml) {
            if ($xml !== false) {
                $items = parseRSS($xml, $source);
                $allItems = array_merge($allItems, $items);
                
                // Update timestamp for this feed
                $feedTimestamps[$source] = $currentTime;
            }
        }
    }
    
    // Update the cache with new data
    // We need to merge with existing cached items that we didn't refresh
    foreach ($itemsBySource as $source => $items) {
        if (!isset($feedsToFetch[$source])) {
            // This source wasn't refreshed, so add its items to allItems
            $allItems = array_merge($allItems, $items);
        }
    }
    
    // Sort by date, newest first
    usort($allItems, function($a, $b) {
        return $b['date'] - $a['date'];
    });

    // Update cache files
    file_put_contents($cacheFile, json_encode($allItems));
    file_put_contents($cacheTimestampFile, json_encode($feedTimestamps));
}

// Log the total number of stories
$totalStories = count($allItems);
logMessage("Total stories fetched: $totalStories");

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
