<?php

// Cache duration in seconds
$cacheDuration = 600;
$cacheFile = '/tmp/rss_cache.json';
$cacheTimestampFile = '/tmp/rss_cache_timestamp';

header('Content-Type: application/json');

// Check if reload parameter is set to bypass cache
$forceReload = isset($_GET['reload']);

// Get number of stories to return
$numStories = isset($_GET['n']) ? intval($_GET['n']) : 30;
$numStories = max(1, min(50, $numStories));

// Check if cache exists and is fresh (unless forced reload is requested)
if (!$forceReload && file_exists($cacheFile) && file_exists($cacheTimestampFile)) {
    $timestamp = file_get_contents($cacheTimestampFile);
    if ((time() - $timestamp) < $cacheDuration) {
        // Cache is still fresh, return cached content
        echo file_get_contents($cacheFile);
        exit;
    }
}

// If cache is stale or missing, fetch new RSS feeds

// List of RSS feeds to fetch
$feeds = [
    'wsj' => 'https://feeds.content.dowjones.io/public/rss/RSSWorldNews',
    'nyt' => 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml',
    'bbc' => 'http://feeds.bbci.co.uk/news/world/rss.xml',
    'wapo' => 'https://feeds.washingtonpost.com/rss/national',
    'techcrunch' => 'https://techcrunch.com/feed/',
    'thedrive' => 'https://www.thedrive.com/feed',
    'notateslaapp' => 'https://www.notateslaapp.com/rss',
    'teslarati' => 'https://www.teslarati.com/feed/',
    'toc' => 'https://teslamotorsclub.com/tmc/forums/-/index.rss',
    'insideevs' => 'https://insideevs.com/rss/articles/all/',
    'theverge' => 'https://www.theverge.com/rss/index.xml',
    'electrek' => 'https://electrek.co/feed/',
    // 'jalopnik' => 'https://jalopnik.com/rss',
    // 'bloomberg-tech' => 'https://feeds.bloomberg.com/technology/news.rss',
    // 'bloomberg' => 'https://feeds.bloomberg.com/news.rss',
];

function fetchRSS($url) {
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 10);
    curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (compatible; RSS Reader Bot/1.0)');
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
    $feed = simplexml_load_string($xml);
    if (!$feed) return [];

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
            // If no date is found, use current time
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
        
        if (count($items) >= 5) break; // Only get first 5 items
    }
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

// Cache the results
file_put_contents($cacheFile, json_encode($allItems));
file_put_contents($cacheTimestampFile, time());

echo json_encode($allItems);
