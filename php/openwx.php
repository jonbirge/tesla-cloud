<?php

// openwx.php
// This script acts as a proxy for OpenWeatherMap API requests.
// It reads the API key from a .env file and forwards requests to the OpenWeatherMap API.

require_once 'dotenv.php';

// Load the .env file (default path is './.env')
$dotenv = new DotEnv(__DIR__ . '/../.env');

// Get all variables as an associative array
$_ENV = $dotenv->getAll();

// Check if API key is set
if (!isset($_ENV['OPENWX_KEY'])) {
    http_response_code(500);
    echo json_encode(['error' => 'API key not found in .env file']);
    exit;
}

// Get query parameters
$queryParams = $_GET;

// Check if 'city' parameter is provided
if (isset($queryParams['city']) && !empty($queryParams['city'])) {
    $city = urlencode($queryParams['city']);
    $geoUrl = "http://api.openweathermap.org/geo/1.0/direct?q={$city}&limit=1&appid={$_ENV['OPENWX_KEY']}";
    
    // Set up context for Geocoding API request
    $geoOptions = [
        'http' => [
            'method' => 'GET',
            'header' => 'User-Agent: PHP/' . phpversion(),
            'ignore_errors' => true
        ]
    ];
    $geoContext = stream_context_create($geoOptions);
    
    $geoResponse = @file_get_contents($geoUrl, false, $geoContext);
    $geoData = json_decode($geoResponse, true);

    if (!empty($geoData) && isset($geoData[0]['lat']) && isset($geoData[0]['lon'])) {
        $queryParams['lat'] = $geoData[0]['lat'];
        $queryParams['lon'] = $geoData[0]['lon'];
        // Remove 'city' from parameters to avoid passing it to One Call API
        unset($queryParams['city']);
    } else {
        http_response_code(404);
        echo json_encode(['error' => 'City not found']);
        exit;
    }
}

// Default to Boston, MA weather if no parameters provided
if (empty($queryParams['lat']) || empty($queryParams['lon'])) {
    $queryParams['lat'] = '42.3601';
    $queryParams['lon'] = '-71.0589';
}

// Add API key to query parameters
$queryParams['appid'] = $_ENV['OPENWX_KEY'];

// Get the API endpoint path from the URL path info
$pathInfo = isset($_SERVER['PATH_INFO']) ? $_SERVER['PATH_INFO'] : '';
if (empty($pathInfo)) {
    // Default to One Call API 3.0 endpoint
    $pathInfo = 'data/3.0/onecall';
}

// Remove leading slash if present
$pathInfo = ltrim($pathInfo, '/');

// Build the proxied URL
$baseUrl = 'https://api.openweathermap.org/';
$proxiedUrl = $baseUrl . $pathInfo . '?' . http_build_query($queryParams);

// Set up the stream context with options
$options = [
    'http' => [
        'method' => 'GET',
        'header' => 'User-Agent: PHP/' . phpversion(),
        'ignore_errors' => true
    ],
    'ssl' => [
        'verify_peer' => true,
        'verify_peer_name' => true
    ]
];

$context = stream_context_create($options);

// Use file_get_contents with the created context
$response = @file_get_contents($proxiedUrl, false, $context);

// Get HTTP status code from headers using the modern function
$httpCode = 200; // Default success
$responseHeaders = http_get_last_response_headers();
if ($responseHeaders && isset($responseHeaders[0])) {
    preg_match('/\d{3}/', $responseHeaders[0], $matches);
    if (!empty($matches[0])) {
        $httpCode = intval($matches[0]);
    }
}

// Set HTTP response code and output the response
http_response_code($httpCode);
header('Content-Type: application/json');
echo $response;
