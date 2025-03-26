<?php
// Settings management API
// Provides a simple key-value store for user settings
header('Content-Type: application/json');

// Enable error reporting for debugging
ini_set('display_errors', 1);
error_reporting(E_ALL);

// Define log file path
$logFile = '/tmp/settings_php.log';

// Initialize log file with header
logMessage("=== SETTINGS.PHP STARTED ===");
logMessage("Request URI: " . $_SERVER['REQUEST_URI']);
logMessage("Request Method: " . $_SERVER['REQUEST_METHOD']);

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

// SQL database configuration
$useDatabase = false;
$dbConnection = null;
$dbName = $_ENV['SQL_DB_NAME'] ?? 'teslacloud';
$dbHost = $_ENV['SQL_HOST'] ?? null;
$dbUser = $_ENV['SQL_USER'] ?? null;
$dbPass = $_ENV['SQL_PASS'] ?? null;
$dbPort = $_ENV['SQL_PORT'] ?? '3306';

logMessage("Database config - Host: " . ($dbHost ?: 'Not set') . 
           ", DB: " . ($dbName ?: 'Not set') . 
           ", User: " . ($dbUser ? 'Set' : 'Not set') . 
           ", Password: " . ($dbPass ? 'Set' : 'Not set') . 
           ", Port: $dbPort");

// Try to establish database connection if environment variables are set
if ($dbHost && $dbName && $dbUser) {
    logMessage("Attempting database connection to $dbHost:$dbPort/$dbName");
    try {
        $dsn = "mysql:host={$dbHost};port={$dbPort};dbname={$dbName};charset=utf8mb4";
        $options = [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ];
        
        $dbConnection = new PDO($dsn, $dbUser, $dbPass, $options);
        logMessage("Database connection successful");
        
        // Check if the required table exists, create it if not
        logMessage("Checking if user_settings table exists");
        $tableCheck = $dbConnection->query("SHOW TABLES LIKE 'user_settings'");
        if ($tableCheck->rowCount() == 0) {
            logMessage("user_settings table not found, creating it");
            $sql = "CREATE TABLE user_settings (
                user_id VARCHAR(255) NOT NULL,
                setting_key VARCHAR({$maxKeyLength}) NOT NULL,
                setting_value TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (user_id, setting_key)
            )";
            $dbConnection->exec($sql);
            logMessage("user_settings table created successfully");
        } else {
            logMessage("user_settings table already exists");
        }
        
        $useDatabase = true;
    } catch (PDOException $e) {
        // Log the error but fallback to file-based storage
        $errorMessage = "Database connection failed: " . $e->getMessage();
        logMessage($errorMessage, "ERROR");
        error_log($errorMessage);
        $useDatabase = false;
    }
} else {
    logMessage("Skipping database connection - required environment variables not set", "WARNING");
}

logMessage("Using database storage: " . ($useDatabase ? 'Yes' : 'No'));

if (!$useDatabase) {
    // Fallback to file-based storage if database is not available
    // Ensure data directory exists
    logMessage("Using file-based storage at $dataDir");
    if (!file_exists($dataDir)) {
        logMessage("Data directory does not exist, creating it");
        $mkdirResult = mkdir($dataDir, 0777, true);
        if (!$mkdirResult) {
            $errorMsg = "Failed to create data directory: $dataDir";
            logMessage($errorMsg, "ERROR");
            http_response_code(500);
            echo json_encode(['error' => 'Failed to create data directory', 'path' => $dataDir]);
            exit;
        }
        logMessage("Data directory created successfully");
    }

    // Ensure the directory is writable
    if (!is_writable($dataDir)) {
        logMessage("Data directory not writable, attempting chmod");
        chmod($dataDir, 0777);
        if (!is_writable($dataDir)) {
            $errorMsg = "Data directory not writable after chmod: $dataDir";
            logMessage($errorMsg, "ERROR");
            http_response_code(500);
            echo json_encode(['error' => 'Data directory is not writable', 'path' => $dataDir]);
            exit;
        }
        logMessage("Data directory permissions updated successfully");
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

logMessage("Parsed request - UserID: " . ($userId ?: 'Not set') . ", Key: " . ($key ?: 'Not set'));

// Handle the request based on method
$method = $_SERVER['REQUEST_METHOD'];

switch ($method) {
    case 'POST':
        logMessage("Processing POST request");
        // POST request - create a new user settings resource
        if (!$userId || !validateUserId($userId)) {
            logMessage("Invalid or missing user ID: $userId", "ERROR");
            http_response_code(400);
            // echo json_encode(['error' => 'Invalid or missing user ID in URL path']);
            exit;
        }
        
        // Check if user settings already exist
        logMessage("Checking if user settings exist for $userId");
        if (userSettingsExist($userId)) {
            logMessage("User settings already exist for $userId", "WARNING");
            http_response_code(409); // Conflict
            // echo json_encode(['error' => 'User settings already exist']);
            exit;
        }
        
        // Save the default settings
        logMessage("Creating new user settings with defaults for $userId");
        if (saveUserSettings($userId, $defaultSettings)) {
            logMessage("User settings created successfully for $userId");
            http_response_code(201); // Created
            echo json_encode([
                'success' => true, 
                'userId' => $userId, 
                'message' => 'User settings created with default values',
                'settings' => $defaultSettings
            ]);
        } else {
            logMessage("Failed to create user settings for $userId", "ERROR");
            http_response_code(500);
            // echo json_encode(['error' => 'Failed to create user settings']);
        }
        break;
        
    case 'HEAD':
        logMessage("Processing HEAD request");
        // HEAD request - check if user settings exist without returning content
        if (!$userId || !validateUserId($userId)) {
            logMessage("Invalid or missing user ID: $userId", "ERROR");
            http_response_code(400);
            exit;
        }
        
        if (!userSettingsExist($userId)) {
            logMessage("User settings not found for $userId", "WARNING");
            http_response_code(404);
            exit;
        }
        
        // Resource exists, return 200 OK (with no body)
        logMessage("User settings found for $userId");
        http_response_code(200);
        exit;
        
    case 'GET':
        logMessage("Processing GET request");
        // GET request - retrieve settings for a user
        if (!$userId || !validateUserId($userId)) {
            logMessage("Invalid or missing user ID: $userId", "ERROR");
            http_response_code(400);
            echo json_encode(['error' => 'Invalid or missing user ID in URL path']);
            exit;
        }

        // Check if the user settings exist
        logMessage("Checking if user settings exist for $userId");
        if (!userSettingsExist($userId)) {
            logMessage("User settings not found for $userId", "WARNING");
            http_response_code(404);
            echo json_encode(['error' => 'User ID not found']);
            exit;
        }

        $settings = loadUserSettings($userId);

        if ($key) {
            // Return settings where the key starts with the given prefix
            $filteredSettings = array_filter($settings, function ($k) use ($key) {
                return strpos($k, $key) === 0; // Check if the key starts with the prefix
            }, ARRAY_FILTER_USE_KEY);

            if (!empty($filteredSettings)) {
                logMessage("Returning settings with prefix '$key' for user $userId");
                echo json_encode($filteredSettings);
            } else {
                logMessage("No settings found with prefix '$key' for user $userId", "WARNING");
                http_response_code(404);
                echo json_encode(['error' => "No settings found with prefix '$key'"]);
            }
        } else {
            // Return all settings if no key is provided
            logMessage("Returning all settings for user $userId");
            echo json_encode($settings);
        }
        break;
        
    case 'PUT':
        logMessage("Processing PUT request");
        // PUT request - update or create a setting
        if (!$userId || !validateUserId($userId)) {
            logMessage("Invalid or missing user ID: $userId", "ERROR");
            http_response_code(400);
            // echo json_encode(['error' => 'Invalid or missing user ID in URL path']);
            exit;
        }
        
        if (!$key) {
            logMessage("Missing key in URL path", "ERROR");
            http_response_code(400);
            // echo json_encode(['error' => 'Missing key in URL path']);
            exit;
        }
        
        // Validate key length
        if (strlen($key) > $maxKeyLength) {
            logMessage("Key too long: $key", "ERROR");
            http_response_code(400);
            // echo json_encode(['error' => 'Key too long']);
            exit;
        }
        
        // Parse the input
        $requestData = json_decode(file_get_contents('php://input'), true);
        
        if (!isset($requestData['value'])) {
            logMessage("Missing value parameter", "ERROR");
            http_response_code(400);
            // echo json_encode(['error' => 'Missing value parameter']);
            exit;
        }
        
        $value = $requestData['value'];
        
        // Validate value length
        if (strlen(json_encode($value)) > $maxValueLength) {
            logMessage("Value too long", "ERROR");
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
        $isCreatingResource = !userSettingsExist($userId);
        
        // Update the setting
        $settings[$key] = $value;
        
        // Save updated settings
        logMessage("Saving updated settings for user $userId");
        if (saveUserSettings($userId, $settings)) {
            // Return 201 Created if this was a new resource, otherwise 200 OK
            if ($isCreatingResource) {
                logMessage("Created new setting $key for user $userId");
                http_response_code(201);
                echo json_encode(['success' => true, 'key' => $key, 'created' => true]);
            } else {
                logMessage("Updated setting $key for user $userId");
                echo json_encode(['success' => true, 'key' => $key]);
            }
        } else {
            logMessage("Failed to save setting $key for user $userId", "ERROR");
            http_response_code(500);
            // echo json_encode(['error' => 'Failed to save setting']);
        }
        break;
        
    default:
        logMessage("Invalid method: $method", "ERROR");
        // Method not allowed
        http_response_code(405);
        // echo json_encode(['error' => 'Method not allowed']);
        break;
}

// Log completion of request
logMessage("Request completed with status code: " . http_response_code());


// ***** Utility Functions *****

// Helper function to validate user ID
function validateUserId($userId) {
    $isValid = (strlen($userId) >= 9) && preg_match('/^[a-zA-Z0-9_-]+$/', $userId);
    logMessage("Validating user ID: $userId - " . ($isValid ? "Valid" : "Invalid"));
    return $isValid;
}

// Helper function to check if user settings exist
function userSettingsExist($userId) {
    global $useDatabase, $dbConnection;
    
    if ($useDatabase) {
        try {
            logMessage("Checking if user $userId exists in database");
            $stmt = $dbConnection->prepare("SELECT 1 FROM user_settings WHERE user_id = ? LIMIT 1");
            $stmt->execute([$userId]);
            $exists = $stmt->rowCount() > 0;
            logMessage("Database check result: " . ($exists ? "User exists" : "User does not exist"));
            return $exists;
        } catch (PDOException $e) {
            $errorMsg = "Database error checking if user settings exist: " . $e->getMessage();
            logMessage($errorMsg, "ERROR");
            error_log($errorMsg);
            // Fall back to file-based check
            logMessage("Falling back to file check after database error");
        }
    }
    
    // File-based fallback
    $filePath = getUserFilePath($userId);
    $exists = file_exists($filePath);
    logMessage("File check result for $filePath: " . ($exists ? "File exists" : "File does not exist"));
    return $exists;
}

// Helper function to get user settings file path
function getUserFilePath($userId) {
    global $dataDir;
    $sanitizedId = preg_replace('/[^a-zA-Z0-9_-]/', '', $userId);
    $filePath = $dataDir . '/' . $sanitizedId . '.json';
    logMessage("Generated file path for user $userId: $filePath");
    return $filePath;
}

// Helper function to load user settings
function loadUserSettings($userId) {
    global $useDatabase, $dbConnection, $defaultSettings;
    logMessage("Loading settings for user $userId");
    
    if ($useDatabase) {
        try {
            logMessage("Attempting to load settings from database for $userId");
            $settings = [];
            $stmt = $dbConnection->prepare("SELECT setting_key, setting_value FROM user_settings WHERE user_id = ?");
            $stmt->execute([$userId]);
            $rowCount = $stmt->rowCount();
            logMessage("Found $rowCount setting(s) in database for user $userId");
            
            if ($rowCount > 0) {
                while ($row = $stmt->fetch()) {
                    // Parse stored JSON value or use as is if parsing fails
                    $value = json_decode($row['setting_value'], true);
                    $settings[$row['setting_key']] = ($value !== null) ? $value : $row['setting_value'];
                    logMessage("Loaded setting {$row['setting_key']} from database with value type: " . gettype($value));
                }
                return $settings;
            }
            
            // If no settings in DB but this was called, create default settings
            logMessage("No settings found in database, saving defaults", "WARNING");
            saveUserSettings($userId, $defaultSettings);
            return $defaultSettings;
        } catch (PDOException $e) {
            $errorMsg = "Database error loading user settings: " . $e->getMessage();
            logMessage($errorMsg, "ERROR");
            error_log($errorMsg);
            // Fall back to file-based loading
            logMessage("Falling back to file-based loading after database error");
        }
    }
    
    // File-based fallback
    $filePath = getUserFilePath($userId);
    
    if (file_exists($filePath)) {
        logMessage("Loading settings from file: $filePath");
        $content = file_get_contents($filePath);
        $settings = json_decode($content, true) ?: [];
        logMessage("Loaded " . count($settings) . " setting(s) from file");
        return $settings;
    }
    
    logMessage("No settings file found, returning empty array");
    return [];
}

// Helper function to save user settings
function saveUserSettings($userId, $settings) {
    global $useDatabase, $dbConnection;
    logMessage("Saving settings for user $userId - " . count($settings) . " setting(s)");
    
    if ($useDatabase) {
        try {
            logMessage("Attempting to save settings to database");
            $dbConnection->beginTransaction();
            
            // Delete existing settings for this user
            $deleteStmt = $dbConnection->prepare("DELETE FROM user_settings WHERE user_id = ?");
            $deleteStmt->execute([$userId]);
            $deletedCount = $deleteStmt->rowCount();
            logMessage("Deleted $deletedCount existing setting(s) for user $userId");
            
            // Insert new settings
            $insertStmt = $dbConnection->prepare("INSERT INTO user_settings (user_id, setting_key, setting_value) VALUES (?, ?, ?)");
            $insertCount = 0;
            
            foreach ($settings as $key => $value) {
                $jsonValue = json_encode($value);
                $insertStmt->execute([$userId, $key, $jsonValue]);
                $insertCount++;
                logMessage("Inserted setting: $key with value type: " . gettype($value));
            }
            
            $dbConnection->commit();
            logMessage("Database transaction committed successfully - inserted $insertCount setting(s)");
            return true;
        } catch (PDOException $e) {
            $dbConnection->rollBack();
            $errorMsg = "Database error saving user settings: " . $e->getMessage();
            logMessage($errorMsg, "ERROR");
            error_log($errorMsg);
            logMessage("Database transaction rolled back, falling back to file-based saving");
            // Fall back to file-based saving
        }
    }
    
    // File-based fallback
    $filePath = getUserFilePath($userId);
    logMessage("Saving settings to file: $filePath");
    $result = file_put_contents($filePath, json_encode($settings, JSON_PRETTY_PRINT));
    
    if ($result === false) {
        logMessage("Failed to write settings to file: $filePath", "ERROR");
        return false;
    } else {
        logMessage("Successfully wrote " . $result . " bytes to settings file");
        return true;
    }
}

// Simple logging function
function logMessage($message, $level = 'INFO') {
    global $logFile;
    $timestamp = date('Y-m-d H:i:s');
    $formattedMessage = "[$timestamp] [$level] $message" . PHP_EOL;
    file_put_contents($logFile, $formattedMessage, FILE_APPEND);
}
