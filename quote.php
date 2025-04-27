<?php
// Set headers for JSON response and CORS
header('Content-Type: application/json');
header('Cache-Control: no-cache, no-store, must-revalidate');
header('Pragma: no-cache');
header('Expires: 0');

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
if (!isset($_ENV['ALPHAVANTAGE_KEY'])) {
    http_response_code(500);
    echo json_encode(['error' => 'API key not found in .env file']);
    exit;
}

// Get the API key from environment variables
$api_key = $_ENV['ALPHAVANTAGE_KEY'];

// Default ticker is S&P 500 (^GSPC)
$ticker = isset($_GET['symbol']) ? $_GET['symbol'] : 'SPY'; // Using SPY ETF as a proxy for S&P 500

// Validate ticker to prevent injection
if (!preg_match('/^[A-Za-z0-9\.\-\_]+$/', $ticker)) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid ticker symbol']);
    exit;
}

// Alpha Vantage API URL for daily time series
$url = "https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol={$ticker}&apikey={$api_key}";

// Initialize cURL session
$ch = curl_init();

// Set cURL options
curl_setopt($ch, CURLOPT_URL, $url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

// Execute cURL request
$response = curl_exec($ch);
$statusCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);

// Close cURL session
curl_close($ch);

// Check for errors
if ($statusCode !== 200) {
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
if (!$data || isset($data['Error Message']) || !isset($data['Global Quote']) || empty($data['Global Quote'])) {
    // If using demo key, provide fallback static data
    if ($api_key === "demo") {
        // Static fallback data for demo mode
        $output = [
            'symbol' => 'SPY',
            'price' => 471.85,
            'previousClose' => 469.23,
            'percentChange' => 0.56
        ];
        
        echo json_encode($output);
        exit;
    }
    
    http_response_code(500);
    echo json_encode(['error' => 'Invalid response from Alpha Vantage API', 'data' => $data]);
    exit;
}

// Extract the relevant data
$quote = $data['Global Quote'];
$currentPrice = floatval($quote['05. price']);
$previousClose = floatval($quote['08. previous close']);
$percentChange = floatval($quote['10. change percent']);

// Format the response - clean up percent change to just be numeric
$percentChange = floatval(str_replace(['%', '+'], '', $percentChange));

$output = [
    'symbol' => $quote['01. symbol'],
    'price' => $currentPrice,
    'previousClose' => $previousClose,
    'percentChange' => $percentChange
];

// Return the JSON response
echo json_encode($output);
