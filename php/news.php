<?php

// Include the git info function
require_once __DIR__ . '/git_info.php';

// Set the content type and add headers to prevent caching
header('Cache-Control: no-cache, no-store, must-revalidate');
header('Expires: 0');
header('Content-Type: application/json');

// Buffer output so we can return well-formed JSON even if a fatal error occurs
ob_start();

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

// Load RSS feeds from JSON file
function loadNewsSourcesFromJson() {
    $jsonFile = __DIR__ . '/../json/news-feeds.json';
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
    
    // Extract feeds from new structure 
    $feedsData = isset($sources['feeds']) ? $sources['feeds'] : $sources;
    
    // Convert to the format expected by the rest of the code
    $feeds = [];
    foreach ($feedsData as $source) {
        $feedData = [
            'url' => $source['url'],
            'cache' => $source['cache']
        ];
        if (isset($source['icon'])) {
            $feedData['icon'] = $source['icon'];
        }
        $feeds[$source['id']] = $feedData;
    }
    
    return $feeds;
}

// List of RSS feeds to fetch - loaded from JSON
$feeds = loadNewsSourcesFromJson();

// Set up error logging
ini_set('log_errors', 1);
ini_set('error_log', '/tmp/rss-php-errors.log');

// Set reasonable execution time limit to allow for slow feeds
// With 27 feeds @ 1.5s timeout each, worst case is ~40s, so set to 60s to be safe
set_time_limit(60);

// Custom error handler to capture all types of errors
set_error_handler(function($errno, $errstr, $errfile, $errline) {
    $message = date('[Y-m-d H:i:s] ') . "Error ($errno): $errstr in $errfile on line $errline\n";
    error_log($message);
    return false; // Let PHP handle the error as well
});

// Register shutdown function to catch fatal errors and return safe JSON
register_shutdown_function(function() {
    $error = error_get_last();
    // Check for any fatal error including timeouts (E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR)
    if ($error && in_array($error['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR])) {
        $message = date('[Y-m-d H:i:s] ') . "FATAL Error: {$error['message']} in {$error['file']} on line {$error['line']}\n";
        error_log($message);
        logMessage("FATAL Error caught by shutdown handler: {$error['message']}");

        // Ensure the client receives valid JSON even after a fatal error
        if (ob_get_length()) {
            ob_clean();
        }
        if (!headers_sent()) {
            header('Content-Type: application/json');
        }
        global $allItems, $outputItemsGlobal, $requestedFeeds, $maxAgeSeconds, $numStories;
        
        // Try to process whatever we have collected so far
        $fallbackArray = $allItems ?? [];
        
        // Apply the same filtering logic as the main code path
        if (!empty($fallbackArray) && isset($requestedFeeds)) {
            // Sort by date, newest first
            usort($fallbackArray, function($a, $b) {
                return $b['date'] - $a['date'];
            });
            
            // Apply inclusion filters if we have the data
            $fallbackArray = applyInclusionFilters($fallbackArray, $requestedFeeds);
            
            // Filter by age if we have the limit
            if (isset($maxAgeSeconds)) {
                $fallbackArray = applyAgeFilter($fallbackArray, $maxAgeSeconds);
            }
            
            // Limit number of stories
            if (isset($numStories)) {
                $fallbackArray = array_slice($fallbackArray, 0, $numStories);
            }
        }
        
        logMessage("Shutdown handler returning " . count($fallbackArray) . " items from partial fetch");
        $fallback = json_encode($fallbackArray);
        echo $fallback === false ? '[]' : $fallback;
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
logMessage("Starting to process " . count($requestedFeeds) . " feeds");

// Collect all items
$allItems = [];
$outputItemsGlobal = null; // Used for shutdown fallback
$currentTime = time();
$updatedTimestamps = false;
$feedsProcessed = 0;
$totalFeeds = count($requestedFeeds);

foreach ($requestedFeeds as $source) {
    $feedsProcessed++;
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
            logMessage("Failed to fetch {$source} from internet after {$downloadTime}ms - treating as empty feed.");
            // Don't update cache or timestamp when fetch fails due to timeout - leave existing cache intact
        }
    }
    
    // Log progress every 5 feeds to help track execution
    if ($feedsProcessed % 5 == 0) {
        logMessage("Progress: Processed {$feedsProcessed}/{$totalFeeds} feeds, collected " . count($allItems) . " items so far");
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

// Store for potential shutdown fallback
$outputItemsGlobal = $outputItems;

// Return filtered cached content with sanity check
$jsonOutput = json_encode($outputItems);
if ($jsonOutput === false) {
    error_log('JSON Encode Error: ' . json_last_error_msg());
    $jsonOutput = '[]';
}
echo $jsonOutput;
ob_end_flush();


// ***** Utility functions *****

function fetchRSS($url) {
    $startTime = microtime(true);
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 1.5); // Changed from 10 to 1.5 seconds
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

        // Try alternative fields for link if still empty
        if (!$link && isset($item->guid)) {
            $link = (string)$item->guid;
        }
        if (!$link && isset($item->id)) {
            $link = (string)$item->id;
        }

        // Resolve relative URLs using channel link if available
        if ($link && strpos($link, 'http') !== 0) {
            $baseLink = '';
            if (isset($feed->channel) && isset($feed->channel->link)) {
                $baseLink = (string)$feed->channel->link;
            }
            if ($baseLink) {
                $link = rtrim($baseLink, '/') . '/' . ltrim($link, '/');
            }
        }

        // Validate URL format
        if ($link && !filter_var($link, FILTER_VALIDATE_URL)) {
            $link = "";
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
