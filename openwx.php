<?php

// wx_proxy.php
// This script acts as a proxy for OpenWeatherMap API requests.
// It reads the API key from a .env file and forwards requests to the OpenWeatherMap API.

// Load .env variables from a JSON file
$envFilePath = __DIR__ . '/.env';
if (file_exists($envFilePath)) {
    $envContent = file_get_contents($envFilePath);
    $envVariables = json_decode($envContent, true);

    if (json_last_error() === JSON_ERROR_NONE) {
        foreach ($envVariables as $key => $value) {
            $_ENV[$key] = $value;
        }
    } else {
        error_log("Failed to parse .env file: " . json_last_error_msg());
    }
} else {
    error_log(".env file not found at $envFilePath");
}

// Check if API key is set
if (!isset($_ENV['OPENWX_KEY'])) {
    http_response_code(500);
    echo json_encode(['error' => 'API key not found in .env file']);
    exit;
}

// Get query parameters
$queryParams = $_GET;

// Add API key to query parameters
$queryParams['appid'] = $_ENV['OPENWX_KEY'];

// Get the API endpoint path from the URL path info
$pathInfo = isset($_SERVER['PATH_INFO']) ? $_SERVER['PATH_INFO'] : '';
if (empty($pathInfo)) {
    http_response_code(400);
    echo json_encode(['error' => 'No API endpoint specified in path']);
    exit;
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

// Get HTTP status code from headers
$httpCode = 200; // Default success
if (isset($http_response_header[0])) {
    preg_match('/\d{3}/', $http_response_header[0], $matches);
    $httpCode = intval($matches[0]);
}

// Set HTTP response code and output the response
http_response_code($httpCode);
header('Content-Type: application/json');
echo $response;
