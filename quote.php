<?php

require_once 'dotenv.php';

// Set headers for JSON response and CORS
header('Content-Type: application/json');
header('Cache-Control: no-cache, no-store, must-revalidate');
header('Pragma: no-cache');
header('Expires: 0');

// Cache configuration
$cacheLifetimeMinutes = 5; // Default cache lifetime in minutes

// Load the .env file (default path is './.env')
$dotenv = new DotEnv();

// Get all variables as an associative array
$_ENV = $dotenv->getAll();

// Check if API key is set
if (!isset($_ENV['FINNHUB_KEY'])) {
    http_response_code(500);
    echo json_encode(['error' => 'API key not found in .env file']);
    exit;
}

// Get the API key from environment variables
$api_key = $_ENV['FINNHUB_KEY'];

// Default ticker is S&P 500 (^GSPC)
$ticker = isset($_GET['symbol']) ? $_GET['symbol'] : 'SPY'; // Using SPY ETF as a proxy for S&P 500

// Validate ticker to prevent injection
if (!preg_match('/^[A-Za-z0-9\.\-\_]+$/', $ticker)) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid ticker symbol']);
    exit;
}

// Check cache before making API request
$cacheFile = "/tmp/stock_cache_{$ticker}.json";
$useCache = false;

if (file_exists($cacheFile)) {
    $cachedContent = file_get_contents($cacheFile);
    $cachedData = json_decode($cachedContent, true);
    
    if (json_last_error() === JSON_ERROR_NONE && isset($cachedData['timestamp'])) {
        $cacheAge = time() - $cachedData['timestamp'];
        if ($cacheAge < ($cacheLifetimeMinutes * 60)) {
            // Cache is valid, use it
            $responseData = $cachedData['data'];
            $responseData['cache'] = true;
            echo json_encode($responseData);
            exit;
        }
    }
}

// Polygon.io API URL for previous day's data
$url = "https://finnhub.io/api/v1/quote?symbol={$ticker}&token={$api_key}";

// Set up the stream context with options (replacing cURL options)
$options = [
    'http' => [
        'method' => 'GET',
        'header' => 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'ignore_errors' => true
    ],
    'ssl' => [
        'verify_peer' => true,
        'verify_peer_name' => true
    ]
];

$context = stream_context_create($options);

// Use file_get_contents with the created context
$response = @file_get_contents($url, false, $context);

// Get HTTP status code from headers
$statusCode = 0;
if (isset($http_response_header[0])) {
    preg_match('/\d{3}/', $http_response_header[0], $matches);
    $statusCode = intval($matches[0]);
}

// Check for errors
if ($statusCode !== 200 || $response === false) {
    http_response_code(500);
    echo json_encode([
        'error' => 'Failed to fetch data',
        'status' => $statusCode
    ]);
    exit;
}

// Parse the response
$data = json_decode($response, true);

// Check if we have valid data
if (!$data || empty($data)) {
    http_response_code(500);
    echo json_encode(['error' => 'Invalid response from API', 'data' => $data]);
    exit;
}

// Extract the relevant data from Polygon response
$currentPrice = floatval($data['c']);   // (Current or closing price)
$percentChange = floatval($data['dp']); // (Percentage change)
$time = intval($data['t']);             // (Timestamp)

$output = [
    'symbol' => $ticker,
    'quoteTime'=> $time,
    'price' => $currentPrice,
    'percentChange' => $percentChange,
    'cache' => false
];

// Save to cache
$cacheData = [
    'timestamp' => time(),
    'data' => $output
];
file_put_contents($cacheFile, json_encode($cacheData));

// Return the JSON response
echo json_encode($output);
