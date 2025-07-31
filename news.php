<?php

// Include the git info function
require_once __DIR__ . '/git_info.php';

// Set the content type and add headers to prevent caching
header('Cache-Control: no-cache, no-store, must-revalidate');
header('Expires: 0');
header('Content-Type: application/json');

// Get version information directly using the function
// TODO: Remove this once deployment is containerized
$gitInfo = getGitInfo();
$version = isset($gitInfo['commit']) ? $gitInfo['commit'] : 'unknown';

// Check if reload parameter is set to bypass cache
$forceReload = isset($_GET['reload']);

// Check if serial fetching is requested
$useSerialFetch = isset($_GET['serial']);

// Settings
$cacheDir = '/tmp';
$cacheTimestampFile = $cacheDir . '/rss_cache_timestamp_' . $version . '.json';
$logFile = $cacheDir . '/rss_php_' . $version . '.log';
$maxStories = 512;
$maxSingleSource = 32;

// Get number of stories to return
$numStories = isset($_GET['n']) ? intval($_GET['n']) : $maxStories;
$numStories = max(1, min($maxStories, $numStories));

// Get maximum age in days (default: 2 days)
$maxAgeDays = isset($_GET['age']) ? floatval($_GET['age']) : 2.0;
$maxAgeSeconds = $maxAgeDays * 86400; // Convert days to seconds

// List of RSS feeds to fetch - now with individual cache durations in minutes
$feeds = [
    'wsj' => ['url' => 'https://feeds.content.dowjones.io/public/rss/RSSWorldNews', 'cache' => 5],
    'nyt' => ['url' => 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml', 'cache' => 5],
    'wapo' => ['url' => 'https://www.washingtonpost.com/arcio/rss/category/politics/', 'cache' => 15],
    'latimes' => ['url' => 'https://www.latimes.com/rss2.0.xml', 'cache' => 15],
    'bos' => ['url' => 'https://www.boston.com/tag/local-news/feed', 'cache' => 15],
    'den' => ['url' => 'https://www.denverpost.com/feed/', 'cache' => 15],
    'chi' => ['url' => 'https://www.chicagotribune.com/news/feed/', 'cache' => 15],
    'bbc' => ['url' => 'http://feeds.bbci.co.uk/news/world/rss.xml', 'cache' => 15],
    'lemonde' => ['url' => 'https://www.lemonde.fr/rss/une.xml', 'cache' => 60],
    'bloomberg' => ['url' => 'https://feeds.bloomberg.com/news.rss', 'cache' => 15],
    'economist' => ['url' => 'https://www.economist.com/latest/rss.xml', 'cache' => 60],
    'cnn' => ['url' => 'https://openrss.org/www.cnn.com', 'cache' => 15, 'icon' => 'https://www.cnn.com/'],
    'ap' => ['url' => 'https://news.google.com/rss/search?q=when:24h+allinurl:apnews.com&hl=en-US&gl=US&ceid=US:en', 'cache' => 30, 'icon' => 'https://apnews.com/'],
    'notateslaapp' => ['url' => 'https://www.notateslaapp.com/rss', 'cache' => 30],
    'teslarati' => ['url' => 'https://www.teslarati.com/feed/', 'cache' => 30],
    'insideevs' => ['url' => 'https://insideevs.com/rss/articles/all/', 'cache' => 30],
    'thedrive' => ['url' => 'https://www.thedrive.com/feed', 'cache' => 30],
    'caranddriver' => ['url' => 'https://www.caranddriver.com/rss/all.xml/', 'cache' => 30],
    'techcrunch' => ['url' => 'https://techcrunch.com/feed/', 'cache' => 30],
    'arstechnica' => ['url' => 'https://feeds.arstechnica.com/arstechnica/index', 'cache' => 30],
    'engadget' => ['url' => 'https://www.engadget.com/rss.xml', 'cache' => 30],
    'gizmodo' => ['url' => 'https://gizmodo.com/rss', 'cache' => 30],
    'theverge' => ['url' => 'https://www.theverge.com/rss/index.xml', 'cache' => 30],
    'wired' => ['url' => 'https://www.wired.com/feed/rss', 'cache' => 30],
    'spacenews' => ['url' => 'https://spacenews.com/feed/', 'cache' => 30],
    'defensenews' => ['url' => 'https://www.defensenews.com/arc/outboundfeeds/rss/?outputType=xml', 'cache' => 30],
    'aviationweek' => ['url' => 'https://aviationweek.com/awn/rss-feed-by-content-source', 'cache' => 30]
];

// Set up error logging
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

// Load timestamp data if it exists
$feedTimestamps = [];
if (file_exists($cacheTimestampFile)) {
    $feedTimestamps = json_decode(file_get_contents($cacheTimestampFile), true);
    if (!is_array($feedTimestamps)) {
        $feedTimestamps = [];
    }
}

// Determine which feeds to process
$requestedFeeds = empty($includedFeeds) ? array_keys($feeds) : $includedFeeds;

// Collect all items
$allItems = [];
$currentTime = time();
$updatedTimestamps = false;

foreach ($requestedFeeds as $source) {
    if (!isset($feeds[$source])) continue;
    $feedData = $feeds[$source];
    $cacheFile = "{$cacheDir}/rss_cache_{$source}_{$version}.json";
    $cacheDurationSeconds = $feedData['cache'] * 60;
    $lastUpdated = isset($feedTimestamps[$source]) ? $feedTimestamps[$source] : 0;
    $useCache = false;

    if (!$forceReload && file_exists($cacheFile) && ($currentTime - $lastUpdated) <= $cacheDurationSeconds) {
        // Use cache
        $cachedItems = json_decode(file_get_contents($cacheFile), true);
        if (is_array($cachedItems)) {
            $allItems = array_merge($allItems, $cachedItems);
            logMessage("Loaded {$source} from cache.");
            $useCache = true;
        }
    }

    if (!$useCache) {
        // Fetch and cache with timing
        $startTime = microtime(true);
        $xml = $useSerialFetch ? fetchRSS($feedData['url']) : fetchRSS($feedData['url']); // Only one at a time now
        $endTime = microtime(true);
        $downloadTime = round(($endTime - $startTime) * 1000, 2); // Convert to milliseconds
        
        if ($xml !== false) {
            $items = parseRSS($xml, $source);
            file_put_contents($cacheFile, json_encode($items));
            $feedTimestamps[$source] = $currentTime;
            $updatedTimestamps = true;
            $allItems = array_merge($allItems, $items);
            logMessage("Fetched {$source} from internet in {$downloadTime}ms and updated cache.");
        } else {
            logMessage("Failed to fetch {$source} from internet after {$downloadTime}ms.");
        }
    }
}

// Update timestamps file if needed
if ($updatedTimestamps) {
    file_put_contents($cacheTimestampFile, json_encode($feedTimestamps));
}

// Sort by date, newest first
usort($allItems, function($a, $b) {
    return $b['date'] - $a['date'];
});

// Log the total number of stories
$totalStories = count($allItems);
logMessage("Total stories fetched: $totalStories");

// Apply inclusion filters to data
$outputItems = applyInclusionFilters($allItems, $requestedFeeds);

// Filter items by age
$outputItems = applyAgeFilter($outputItems, $maxAgeSeconds);

// Limit number of stories if needed
$outputItems = array_slice($outputItems, 0, $numStories);

// Return filtered cached content
echo json_encode($outputItems);


// ***** Utility functions *****

function fetchRSS($url) {
    $startTime = microtime(true);
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 10);
    curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (compatible; RSS Reader/1.0)');
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    $response = curl_exec($ch);
    $endTime = microtime(true);
    $curlTime = round(($endTime - $startTime) * 1000, 2); // Convert to milliseconds
    
    if (curl_errno($ch)) {
        error_log("RSS Feed Error after {$curlTime}ms: " . curl_error($ch) . " - URL: " . $url);
        curl_close($ch);
        return false;
    }
    
    curl_close($ch);
    return $response;
}

function parseRSS($xml, $source) {
    global $maxSingleSource, $feeds;

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
    
    // Get icon if present for this source
    $icon = isset($feeds[$source]['icon']) ? $feeds[$source]['icon'] : null;

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
        
        $newsItem = [
            'title' => $title,
            'link' => $link,
            'date' => $pubDate,
            'source' => $source
        ];
        if ($icon) {
            $newsItem['icon'] = $icon;
        }
        $items[] = $newsItem;

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

// Function to apply inclusion filters to items
function applyInclusionFilters($items, $includedFeeds) {
    if (empty($includedFeeds)) {
        // If no feeds are specified, include all feeds
        return $items;
    }
    
    logMessage("Filtering to only include feeds: " . implode(', ', $includedFeeds));
    $filteredItems = array_filter($items, function($item) use ($includedFeeds) {
        return in_array($item['source'], $includedFeeds);
    });
    
    // Re-index array after filtering
    $filteredItems = array_values($filteredItems);
    logMessage("After filtering: " . count($filteredItems) . " items remain");
    
    return $filteredItems;
}

// Function to filter items by age
function applyAgeFilter($items, $maxAgeSeconds) {
    $currentTime = time();
    $filteredItems = array_filter($items, function($item) use ($currentTime, $maxAgeSeconds) {
        // Calculate how old the item is in seconds
        $ageInSeconds = $currentTime - $item['date'];
        // Keep items that are newer than the maximum age
        return ($ageInSeconds <= $maxAgeSeconds);
    });
    
    // Re-index array after filtering
    $filteredItems = array_values($filteredItems);
    logMessage("After age filtering: " . count($filteredItems) . " items remain (max age: " . 
               round($maxAgeSeconds/86400, 2) . " days)");
    
    return $filteredItems;
}

// Function to write timestamped log messages to the end of the log file
function logMessage($message) {
    global $logFile;
    file_put_contents($logFile, date('[Y-m-d H:i:s] ') . $message . "\n", FILE_APPEND);
}
