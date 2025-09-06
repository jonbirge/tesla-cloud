<?php

require_once 'dotenv.php';

// Define log file path
$logFile = '/tmp/ping_php.log';

// Get the request method
$requestMethod = $_SERVER['REQUEST_METHOD'];

// For HEAD requests, return minimal response and exit early
if ($requestMethod === 'HEAD') {
    // No content needed for HEAD requests, just set headers if necessary
    http_response_code(200);
    header('Content-Type: text/plain');
    exit;
}

// For GET requests, just return the current server time
if ($requestMethod === 'GET') {
    // Return the current server time as a human readable string
    header('Content-Type: text/plain');
    echo date('Y-m-d H:i:s');
    exit;
}

// *****Continue with normal processing for POST requests *****

// Load the .env file (default path is './.env')
$dotenv = new DotEnv(__DIR__ . '/../.env');

// Get all variables as an associative array
$_ENV = $dotenv->getAll();

// SQL database configuration
$dbName = $_ENV['SQL_DB_NAME'] ?? 'teslacloud';
$dbHost = $_ENV['SQL_HOST'] ?? null;
$dbUser = $_ENV['SQL_USER'] ?? null;
$dbPass = $_ENV['SQL_PASS'] ?? null;
$dbPort = $_ENV['SQL_PORT'] ?? '3306';

// Get client IP address
$clientIP = $_SERVER['REMOTE_ADDR'];
if (isset($_SERVER['HTTP_X_FORWARDED_FOR']) && filter_var($_SERVER['HTTP_X_FORWARDED_FOR'], FILTER_VALIDATE_IP)) {
    $clientIP = $_SERVER['HTTP_X_FORWARDED_FOR'];
}

// Establish database connection
if ($dbHost && $dbName && $dbUser) {
    try {
        $dsn = "mysql:host={$dbHost};port={$dbPort};dbname={$dbName};charset=utf8mb4";
        $options = [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ];
        
        $dbConnection = new PDO($dsn, $dbUser, $dbPass, $options);
        
        // Check if the ping_data table exists, create it if not
        $tableCheck = $dbConnection->query("SHOW TABLES LIKE 'ping_data'");
        if ($tableCheck->rowCount() == 0) {
            $sql = "CREATE TABLE ping_data (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id VARCHAR(255) NOT NULL,
                latitude DOUBLE NULL,
                longitude DOUBLE NULL,
                altitude DOUBLE NULL,
                ip_address VARCHAR(45) NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )";
            $dbConnection->exec($sql);
            logMessage("Created ping_data table");
        }
        
        // Get data from POST request
        $userId = $_POST['user_id'] ?? 'anonymous';
        $latitude = isset($_POST['latitude']) ? (double)$_POST['latitude'] : null;
        $longitude = isset($_POST['longitude']) ? (double)$_POST['longitude'] : null;
        $altitude = isset($_POST['altitude']) ? (double)$_POST['altitude'] : null;
        $pingTime = isset($_POST['ping']) ? (double)$_POST['ping'] : null;
        
        // Log the ping data to database
        $stmt = $dbConnection->prepare("INSERT INTO ping_data (user_id, latitude, longitude, altitude, ip_address, ping_time) VALUES (?, ?, ?, ?, ?, ?)");
        $stmt->execute([$userId, $latitude, $longitude, $altitude, $clientIP, $pingTime]);
        
        // Respond with 200 OK
        header('Content-Type: text/plain');
        echo "Ping logged successfully.";

        logMessage("Logged ping from user: " . $userId . ", IP: " . $clientIP);
    } catch (PDOException $e) {
        logMessage("Database error: " . $e->getMessage(), "ERROR");
        http_response_code(500);
        header('Content-Type: text/plain');
        echo "Database error: " . $e->getMessage();
        exit;
    }
} else {
    logMessage("Missing database configuration", "WARNING");
    http_response_code(500);
    header('Content-Type: text/plain');
    echo "Database configuration is missing.";
    exit;
}


// Simple logging function
function logMessage($message, $level = 'INFO') {
    global $logFile;
    $timestamp = date('Y-m-d H:i:s');
    $formattedMessage = "[$timestamp] [$level] $message" . PHP_EOL;
    file_put_contents($logFile, $formattedMessage, FILE_APPEND);
}
