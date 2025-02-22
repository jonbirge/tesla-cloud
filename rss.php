<?php
header('Content-Type: application/json');

$feeds = [
    'nyt' => 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml',
    'wsj' => 'https://feeds.a.dj.com/rss/RSSWorldNews.xml',
    'bbc' => 'https://feeds.bbci.co.uk/news/rss.xml'
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

echo json_encode($allItems);
