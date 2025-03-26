<?php
// Settings management API
// Provides a simple key-value store for user settings
header('Content-Type: application/json');

// Enable error reporting for debugging
ini_set('display_errors', 1);
error_reporting(E_ALL);

// Configuration
$dataDir = '/tmp/teslacloud_user_data';  // Use /tmp directory for storage
$maxKeyLength = 64;      // Maximum length for setting keys
$maxValueLength = 1024;  // Maximum length for setting values

// Define default settings
$defaultSettings = [
    "auto-dark-mode" => true,
    "24-hour-time" => false,
    "imperial-units" => true,
    "rss-wsj" => true,
    "rss-nyt" => true,
    "rss-wapo" => true,
    "rss-latimes" => true,
    "rss-bloomberg" => false,
    "rss-bos" => false,
    "rss-bloomberg-tech" => false,
    "rss-bbc" => true,
    "rss-economist" => true,
    "rss-telegraph" => false,
    "rss-lemonde" => false,
    "rss-derspiegel" => true,
    "rss-teslarati" => true,
    "rss-notateslaapp" => true,
    "rss-insideevs" => true,
    "rss-electrek" => false,
    "rss-techcrunch" => true,
    "rss-theverge" => false,
    "rss-jalopnik" => false,
    "rss-thedrive" => false,
];

// Ensure data directory exists
if (!file_exists($dataDir)) {
    $mkdirResult = mkdir($dataDir, 0777, true);
    if (!$mkdirResult) {
        http_response_code(500);
        echo json_encode(['error' => 'Failed to create data directory', 'path' => $dataDir]);
        exit;
    }
}

// Ensure the directory is writable
if (!is_writable($dataDir)) {
    chmod($dataDir, 0777);
    if (!is_writable($dataDir)) {
        http_response_code(500);
        echo json_encode(['error' => 'Data directory is not writable', 'path' => $dataDir]);
        exit;
    }
}

// Parse the request URI to extract user and key
$requestUri = $_SERVER['REQUEST_URI'];
$uriParts = explode('/', trim(parse_url($requestUri, PHP_URL_PATH), '/'));

// Determine which parts of the URL contain our parameters
// Format: settings.php/{userId}[/{key}]
$userId = null;
$key = null;

// Check if we have enough parts to contain a user ID
if (count($uriParts) > 1) {
    $scriptName = basename(__FILE__); // Should be settings.php
    $scriptPos = array_search($scriptName, $uriParts);
    
    if ($scriptPos !== false && isset($uriParts[$scriptPos + 1])) {
        $userId = $uriParts[$scriptPos + 1];
        
        // Check if we also have a key
        if (isset($uriParts[$scriptPos + 2])) {
            $key = $uriParts[$scriptPos + 2];
        }
    }
}

// Handle the request based on method
$method = $_SERVER['REQUEST_METHOD'];

switch ($method) {
    case 'POST':
        // POST request - create a new user settings resource
        if (!$userId || !validateUserId($userId)) {
            http_response_code(400);
            echo json_encode(['error' => 'Invalid or missing user ID in URL path']);
            exit;
        }
        
        // Check if user settings already exist
        $filePath = getUserFilePath($userId);
        if (file_exists($filePath)) {
            http_response_code(409); // Conflict
            echo json_encode(['error' => 'User settings already exist']);
            exit;
        }
        
        // Save the default settings
        if (saveUserSettings($userId, $defaultSettings)) {
            http_response_code(201); // Created
            echo json_encode([
                'success' => true, 
                'userId' => $userId, 
                'message' => 'User settings created with default values',
                'settings' => $defaultSettings
            ]);
        } else {
            http_response_code(500);
            echo json_encode(['error' => 'Failed to create user settings']);
        }
        break;
        
    case 'HEAD':
        // HEAD request - check if user settings exist without returning content
        if (!$userId || !validateUserId($userId)) {
            http_response_code(400);
            exit;
        }
        
        $filePath = getUserFilePath($userId);
        if (!file_exists($filePath)) {
            http_response_code(404);
            exit;
        }
        
        // Resource exists, return 200 OK (with no body)
        http_response_code(200);
        exit;
        
    case 'GET':
        // GET request - retrieve settings for a user
        if (!$userId || !validateUserId($userId)) {
            http_response_code(400);
            echo json_encode(['error' => 'Invalid or missing user ID in URL path']);
            exit;
        }
        
        // Check if the user settings file exists
        $filePath = getUserFilePath($userId);
        if (!file_exists($filePath)) {
            http_response_code(404);
            echo json_encode(['error' => 'User ID not found']);
            exit;
        }
        
        $settings = loadUserSettings($userId);
        
        if ($key) {
            // Return specific setting if key is provided
            if (isset($settings[$key])) {
                echo json_encode(['key' => $key, 'value' => $settings[$key]]);
            } else {
                http_response_code(404);
                echo json_encode(['error' => "Setting '$key' not found"]);
            }
        } else {
            // Return all settings if no key is provided
            echo json_encode($settings);
        }
        break;
        
    case 'PUT':
        // PUT request - update or create a setting
        if (!$userId || !validateUserId($userId)) {
            http_response_code(400);
            echo json_encode(['error' => 'Invalid or missing user ID in URL path']);
            exit;
        }
        
        if (!$key) {
            http_response_code(400);
            echo json_encode(['error' => 'Missing key in URL path']);
            exit;
        }
        
        // Validate key length
        if (strlen($key) > $maxKeyLength) {
            http_response_code(400);
            echo json_encode(['error' => 'Key too long']);
            exit;
        }
        
        // Parse the input
        $requestData = json_decode(file_get_contents('php://input'), true);
        
        if (!isset($requestData['value'])) {
            http_response_code(400);
            echo json_encode(['error' => 'Missing value parameter']);
            exit;
        }
        
        $value = $requestData['value'];
        
        // Validate value length
        if (strlen(json_encode($value)) > $maxValueLength) {
            http_response_code(400);
            echo json_encode(['error' => 'Value too long']);
            exit;
        }
        
        // Convert value to boolean if it's a boolean string or already boolean
        if (is_string($value)) {
            if ($value === 'true') {
                $value = true;
            } elseif ($value === 'false') {
                $value = false;
            }
            // Keep other string values as is - this handles non-boolean settings
        }
        
        // Load current settings
        $settings = loadUserSettings($userId);
        
        // Track if this is a creation operation
        $isCreatingResource = !file_exists(getUserFilePath($userId));
        
        // Update the setting
        $settings[$key] = $value;
        
        // Save updated settings
        if (saveUserSettings($userId, $settings)) {
            // Return 201 Created if this was a new resource, otherwise 200 OK
            if ($isCreatingResource) {
                http_response_code(201);
                echo json_encode(['success' => true, 'key' => $key, 'created' => true]);
            } else {
                echo json_encode(['success' => true, 'key' => $key]);
            }
        } else {
            http_response_code(500);
            echo json_encode(['error' => 'Failed to save setting']);
        }
        break;
        
    default:
        // Method not allowed
        http_response_code(405);
        echo json_encode(['error' => 'Method not allowed']);
        break;
}

// ***** Utility Functions *****

// Helper function to validate user ID
function validateUserId($userId) {
    // Check if it has at least 9 characters and only contains valid characters
    return (strlen($userId) >= 9) && preg_match('/^[a-zA-Z0-9_-]+$/', $userId);
}

// Helper function to get user settings file path
function getUserFilePath($userId) {
    global $dataDir;
    return $dataDir . '/' . preg_replace('/[^a-zA-Z0-9_-]/', '', $userId) . '.json';
}

// Helper function to load user settings
function loadUserSettings($userId) {
    $filePath = getUserFilePath($userId);
    
    if (file_exists($filePath)) {
        $content = file_get_contents($filePath);
        return json_decode($content, true) ?: [];
    }
    
    return [];
}

// Helper function to save user settings
function saveUserSettings($userId, $settings) {
    $filePath = getUserFilePath($userId);
    return file_put_contents($filePath, json_encode($settings, JSON_PRETTY_PRINT));
}
