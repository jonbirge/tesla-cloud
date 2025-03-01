<?php

// Cache duration in seconds
$cacheDuration = 30;
$cacheFile = '/tmp/rss_cache.json';
$cacheTimestampFile = '/tmp/rss_cache_timestamp';

header('Content-Type: application/json');

// Check if reload parameter is set to bypass cache
$forceReload = isset($_GET['reload']);

// Get number of stories to return
$numStories = isset($_GET['n']) ? intval($_GET['n']) : 25;
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

$feeds = [
    'wsj' => 'https://feeds.content.dowjones.io/public/rss/RSSWorldNews',
    'nyt' => 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml',
    'electrek' => 'https://electrek.co/feed/',
    'teslarati' => 'https://www.teslarati.com/feed/',
    'insideevs' => 'https://insideevs.com/rss/articles/all/',
    'teslarumors' => 'https://teslarumors.com/feed/',
    'notatesla' => 'https://notateslaapp.com/feed/',
    'tesla' => 'https://www.tesla.com/rss/blog',
    'theverge' => 'https://www.theverge.com/rss/transportation/index.xml',
    'techcrunch' => 'https://techcrunch.com/transportation/feed/',
    'jalopnik' => 'https://jalopnik.com/rss',
    'bloomberg_tech' => 'https://www.bloomberg.com/feeds/technology.rss',
    'bloomberg' => 'https://www.bloomberg.com/feeds/sitemap_news.xml',
    'reuters' => 'https://www.reuters.com/arc/outboundfeeds/reuters-news/main/',
    'ap' => 'https://feeds.feedburner.com/breaking-news/',
    'bbc' => 'http://feeds.bbci.co.uk/news/world/rss.xml',
    'economist' => 'https://www.economist.com/rss',
    'thedrive' => 'https://www.thedrive.com/feed'
];

function fetchRSS($url) {
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 10);
    $response = curl_exec($ch);
    curl_close($ch);
    return $response;
}

function parseRSS($xml, $source) {
    $feed = simplexml_load_string($xml);
    if (!$feed) return [];

    $items = [];
    foreach ($feed->channel->item as $item) {
        $pubDate = strtotime($item->pubDate);
        $items[] = [
            'title' => (string)$item->title,
            'link' => (string)$item->link,
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
    $items = parseRSS($xml, $source);
    $allItems = array_merge($allItems, $items);
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
