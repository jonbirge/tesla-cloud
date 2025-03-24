<?php
// Settings management API
// Provides a simple key-value store for user settings
header('Content-Type: application/json');

// Configuration
$dataDir = 'user_data';  // Directory to store user data files
$maxKeyLength = 64;      // Maximum length for setting keys
$maxValueLength = 1024;  // Maximum length for setting values

// Ensure data directory exists
if (!file_exists($dataDir)) {
    mkdir($dataDir, 0755, true);
}

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

// Handle the request based on method
$method = $_SERVER['REQUEST_METHOD'];

switch ($method) {
    case 'GET':
        // GET request - retrieve settings for a user
        $userId = isset($_GET['user']) ? $_GET['user'] : null;
        
        if (!$userId || !validateUserId($userId)) {
            http_response_code(400);
            echo json_encode(['error' => 'Invalid user ID']);
            exit;
        }
        
        $settings = loadUserSettings($userId);
        echo json_encode($settings);
        break;
        
    case 'PUT':
        // PUT request - update a setting
        $requestData = json_decode(file_get_contents('php://input'), true);
        
        // Validate request data
        if (!isset($requestData['user']) || !isset($requestData['key']) || !isset($requestData['value'])) {
            http_response_code(400);
            echo json_encode(['error' => 'Missing required parameters']);
            exit;
        }
        
        $userId = $requestData['user'];
        $key = $requestData['key'];
        $value = $requestData['value'];
        
        // Validate user ID
        if (!validateUserId($userId)) {
            http_response_code(400);
            echo json_encode(['error' => 'Invalid user ID']);
            exit;
        }
        
        // Validate key and value
        if (strlen($key) > $maxKeyLength || strlen($value) > $maxValueLength) {
            http_response_code(400);
            echo json_encode(['error' => 'Key or value too long']);
            exit;
        }
        
        // Load current settings
        $settings = loadUserSettings($userId);
        
        // Update the setting
        $settings[$key] = $value;
        
        // Save updated settings
        if (saveUserSettings($userId, $settings)) {
            echo json_encode(['success' => true]);
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
?>