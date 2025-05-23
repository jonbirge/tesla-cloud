<?php

require_once 'dotenv.php';

// Helper function to send JSON responses
function sendJsonResponse($data, $statusCode = 200) {
    http_response_code($statusCode);
    header('Content-Type: application/json');
    if (is_string($data) && json_decode($data) !== null) {
        // Data is already valid JSON string
        echo $data;
    } else {
        echo json_encode($data);
    }
    exit;
}

// Helper function to get the request path after the script name
function getRequestPath() {
    $scriptName = $_SERVER['SCRIPT_NAME'];
    $requestUri = $_SERVER['REQUEST_URI'];
    
    // Parse URL to handle query string properly
    $parsedUri = parse_url($requestUri);
    $path = $parsedUri['path'];
    
    // Remove script name from the path
    if (strpos($path, $scriptName) === 0) {
        $path = substr($path, strlen($scriptName));
    }
    
    // If path is empty, treat it as root path '/'
    if (empty($path)) {
        return '/';
    }
    
    // Ensure path starts with /
    if ($path[0] !== '/') {
        $path = '/' . $path;
    }
    
    return $path;
}

// Load the .env file (default path is './.env')
$dotenv = new DotEnv();
$_ENV = $dotenv->getAll();

$host = $_ENV['SQL_HOST'];
$username = $_ENV['SQL_USER'];
$password = $_ENV['SQL_PASS'];
$dbname = $_ENV['SQL_DB_NAME'];

// Open a connection to the database
try {
    $pdo = new PDO("mysql:host=$host;dbname=$dbname", $username, $password);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    
    // Check if key_value table exists, if not create it
    $tableCheck = $pdo->query("SHOW TABLES LIKE 'key_value'");
    if ($tableCheck->rowCount() == 0) {
        // Table doesn't exist, create it
        $pdo->exec("CREATE TABLE key_value (
            `key` VARCHAR(255) NOT NULL PRIMARY KEY,
            `value` TEXT NULL,
            'expire_at' TIMESTAMP NULL,
            `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )");
    }
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Database connection failed: ' . $e->getMessage()]);
    exit;
}

// Get request method and URI
$method = $_SERVER['REQUEST_METHOD'];
$uri = getRequestPath();

if ($method === 'POST') {
    // POST /dir or /dir/
    // Create a database entry for the directory, with a value of null to show that it is a directory
    
    $path = ltrim($uri, '/');
    // Ensure the path ends with / for consistency in directory naming
    if (substr($path, -1) !== '/') {
        $path .= '/';
    }
    
    // Remove the trailing slash for the database key
    $dbPath = rtrim($path, '/');
    
    // Check if this path already exists
    $stmt = $pdo->prepare("SELECT `value` FROM key_value WHERE `key` = ?");
    $stmt->execute([$dbPath]);
    $result = $stmt->fetch(PDO::FETCH_ASSOC);
    
    if ($result) {
        if ($result['value'] === null) {
            http_response_code(409);
            echo json_encode(['error' => "Directory already exists: $dbPath"]);
        } else {
            http_response_code(400);
            echo json_encode(['error' => "Key already exists with a value: $dbPath"]);
        }
    } else {
        // Check if any parent directories need to be created
        $parts = explode('/', $dbPath);
        array_pop($parts); // Remove the last empty part
        
        if (!empty($parts)) {
            // Create parent directories if they don't exist
            try {
                $pdo->beginTransaction();
                
                $currentPath = '';
                foreach ($parts as $part) {
                    if (!empty($part)) {
                        if (!empty($currentPath)) {
                            $currentPath .= '/';
                        }
                        $currentPath .= $part;
                        
                        // Skip if this is the directory we're trying to create
                        if ($currentPath === $dbPath) continue;
                        
                        // Check if this segment exists
                        $stmt = $pdo->prepare("SELECT COUNT(*) as count FROM key_value WHERE `key` = ?");
                        $stmt->execute([$currentPath]);
                        $exists = $stmt->fetch(PDO::FETCH_ASSOC)['count'] > 0;
                        
                        if (!$exists) {
                            // Create directory entry
                            $stmt = $pdo->prepare("INSERT INTO key_value (`key`, `value`) VALUES (?, NULL)");
                            $stmt->execute([$currentPath]);
                        } else {
                            // Check if it's a key rather than a directory
                            $stmt = $pdo->prepare("SELECT `value` FROM key_value WHERE `key` = ?");
                            $stmt->execute([$currentPath]);
                            $pathResult = $stmt->fetch(PDO::FETCH_ASSOC);
                            
                            if ($pathResult && $pathResult['value'] !== null) {
                                // This is a key, not a directory - conflict
                                $pdo->rollBack();
                                http_response_code(409);
                                echo json_encode(['error' => "Path conflict: $currentPath is a key, not a directory"]);
                                exit;
                            }
                        }
                    }
                }
                
                // Now create the actual directory
                $stmt = $pdo->prepare("INSERT INTO key_value (`key`, `value`) VALUES (?, NULL)");
                $stmt->execute([$dbPath]);
                
                $pdo->commit();
                
                header('Content-Type: application/json');
                http_response_code(201);
                echo json_encode(['status' => 'success', 'message' => "Directory created at $dbPath"]);
                
            } catch (PDOException $e) {
                $pdo->rollBack();
                http_response_code(500);
                echo json_encode(['error' => 'Failed to create directory: ' . $e->getMessage()]);
            }
        } else {
            // Root directory - just create it
            try {
                $stmt = $pdo->prepare("INSERT INTO key_value (`key`, `value`) VALUES (?, NULL)");
                $stmt->execute([$dbPath]);

                header('Content-Type: application/json');
                http_response_code(201);
                echo json_encode(['status' => 'success', 'message' => "Directory created at $dbPath"]);
            } catch (PDOException $e) {
                http_response_code(500);
                echo json_encode(['error' => 'Failed to create directory: ' . $e->getMessage()]);
            }
        }
    }

} elseif ($method === 'PUT') {
    $path = ltrim($uri, '/');
    $json = file_get_contents('php://input');
    
    // Validate JSON input
    if (!json_decode($json)) {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid JSON input']);
        exit;
    }
    
    // Check if this path exists as a directory (has a NULL value)
    $stmt = $pdo->prepare("SELECT `value` FROM key_value WHERE `key` = ?");
    $stmt->execute([$path]);
    $result = $stmt->fetch(PDO::FETCH_ASSOC);
    
    if ($result && $result['value'] === null) {
        http_response_code(409);
        echo json_encode(['error' => "Cannot store value: $path is a directory"]);
        exit;
    }

    // Check if this would conflict with existing directory structure
    // For example, if trying to PUT /dir/subdir/key but /dir/subdir is a key, not a directory
    $parts = explode('/', $path);
    array_pop($parts); // Remove the key part
    
    if (!empty($parts)) {
        $parentDir = implode('/', $parts);
        
        // Check if parent directory exists
        $stmt = $pdo->prepare("SELECT COUNT(*) as count FROM key_value WHERE `key` = ? AND `value` IS NULL");
        $stmt->execute([$parentDir]);
        $parentExists = $stmt->fetch(PDO::FETCH_ASSOC)['count'] > 0;
        
        if (!$parentExists) {
            // Try to create the parent directory structure
            try {
                $pdo->beginTransaction();
                
                // Create all parent directories that don't exist
                $currentPath = '';
                foreach ($parts as $part) {
                    if (!empty($currentPath)) {
                        $currentPath .= '/';
                    }
                    $currentPath .= $part;
                    
                    // Check if this segment exists
                    $stmt = $pdo->prepare("SELECT COUNT(*) as count FROM key_value WHERE `key` = ?");
                    $stmt->execute([$currentPath]);
                    $exists = $stmt->fetch(PDO::FETCH_ASSOC)['count'] > 0;
                    
                    if (!$exists) {
                        // Create directory entry
                        $stmt = $pdo->prepare("INSERT INTO key_value (`key`, `value`) VALUES (?, NULL)");
                        $stmt->execute([$currentPath]);
                    }
                }
                
                $pdo->commit();
            } catch (PDOException $e) {
                $pdo->rollBack();
                http_response_code(500);
                echo json_encode(['error' => 'Failed to create parent directories: ' . $e->getMessage()]);
                exit;
            }
        }
        
        // Check if any segment in the path is already a key with a value
        $stmt = $pdo->prepare("SELECT `key` FROM key_value WHERE `key` IN (" . 
                               implode(',', array_fill(0, count($parts), '?')) . 
                               ") AND `value` IS NOT NULL");
        $stmt->execute($parts);
        $conflictingPath = $stmt->fetch(PDO::FETCH_ASSOC);
        
        if ($conflictingPath) {
            http_response_code(409);
            echo json_encode(['error' => "Path conflict: {$conflictingPath['key']} is a key, not a directory"]);
            exit;
        }
    }

    // Store the actual value
    try {
        $stmt = $pdo->prepare("REPLACE INTO key_value (`key`, `value`) VALUES (?, ?)");
        $stmt->execute([$path, $json]);

        header('Content-Type: application/json');
        http_response_code(201);
        echo json_encode(['status' => 'success', 'message' => "Value stored at $path"]);
    } catch (PDOException $e) {
        http_response_code(500);
        echo json_encode(['error' => 'Failed to store value: ' . $e->getMessage()]);
    }

} elseif ($method === 'GET') {
    $path = ltrim($uri, '/');

    if (substr($uri, -1) === '/' || $uri === '/') {
        // GET /dir/ - list all keys under this directory
        // Special handling for root directory
        $prefix = rtrim($path, '/');
        
        // For root directory, we don't need to check if it exists
        $dirExists = true;
        
        if (!empty($prefix)) {
            // Not root directory, check if it exists
            $stmt = $pdo->prepare("SELECT COUNT(*) as count FROM key_value WHERE `key` = ? AND `value` IS NULL");
            $stmt->execute([$prefix]);
            $dirExists = $stmt->fetch(PDO::FETCH_ASSOC)['count'] > 0;
            
            if (!$dirExists) {
                // Directory doesn't exist
                $stmt = $pdo->prepare("SELECT COUNT(*) as count FROM key_value WHERE `key` = ?");
                $stmt->execute([$prefix]);
                $keyExists = $stmt->fetch(PDO::FETCH_ASSOC)['count'] > 0;
                
                if ($keyExists) {
                    // This is a key, not a directory
                    sendJsonResponse(['error' => "$prefix is a key, not a directory"], 400);
                } else {
                    sendJsonResponse(['error' => "Directory not found: $prefix"], 404);
                }
            }
        }
        
        // Get all keys under this prefix - special case for root
        if (empty($prefix)) {
            // For root listing, get ALL entries in the database
            $stmt = $pdo->prepare("SELECT `key`, `value` FROM key_value");
            $stmt->execute();
        } else {
            // For non-root directories, use the standard prefix search
            $stmt = $pdo->prepare("SELECT `key`, `value` FROM key_value WHERE `key` LIKE ? OR `key` = ?");
            $stmt->execute([$prefix . '/%', $prefix]);
        }
        
        $results = $stmt->fetchAll(PDO::FETCH_ASSOC);
        
        // Transform results into a more useful structure with directory information
        $transformed = [];
        foreach ($results as $item) {
            $isDir = $item['value'] === null;
            
            $transformed[] = [
                'key' => $item['key'],
                'isDir' => $isDir,
                'value' => $isDir ? null : $item['value']
            ];
        }

        if (count($results) > 0 || empty($prefix)) {
            // Always return success for root directory, even if empty
            sendJsonResponse($transformed);
        } else {
            sendJsonResponse(['error' => "No keys found under $prefix/"], 404);
        }
    } else {
        // GET /dir/key - get a specific key
        $stmt = $pdo->prepare("SELECT `value` FROM key_value WHERE `key` = ?");
        $stmt->execute([$path]);
        $result = $stmt->fetch(PDO::FETCH_ASSOC);

        if ($result) {
            if ($result['value'] === null) {
                // This is a directory, not a key
                sendJsonResponse(['error' => "$path is a directory, not a key. Use $path/ to list contents."], 400);
            }
            
            // Return the value directly (it should already be JSON)
            sendJsonResponse($result['value']);
        } else {
            sendJsonResponse(['error' => "Key not found: $path"], 404);
        }
    }

} elseif ($method === 'DELETE') {
    $path = ltrim($uri, '/');
    
    // Check if this is a directory delete (ends with /)
    $isDirectory = substr($path, -1) === '/';
    
    if ($isDirectory) {
        // DELETE /dir/ - delete all keys under this directory including the directory itself
        $prefix = rtrim($path, '/');
        
        try {
            // Begin transaction
            $pdo->beginTransaction();
            
            // Delete all keys under this directory
            $stmt = $pdo->prepare("DELETE FROM key_value WHERE `key` LIKE ? OR `key` = ?");
            $stmt->execute([$prefix . '/%', $prefix]);
            
            $rowCount = $stmt->rowCount();
            
            if ($rowCount > 0) {
                $pdo->commit();
                header('Content-Type: application/json');
                echo json_encode([
                    'status' => 'success', 
                    'message' => "Directory and all contents deleted: $prefix",
                    'count' => $rowCount
                ]);
            } else {
                $pdo->rollBack();
                http_response_code(404);
                header('Content-Type: application/json');
                echo json_encode(['error' => "Directory not found: $prefix"]);
            }
        } catch (PDOException $e) {
            $pdo->rollBack();
            http_response_code(500);
            echo json_encode(['error' => 'Failed to delete directory: ' . $e->getMessage()]);
        }
    } else {
        // DELETE /dir/key - delete specific key
        try {
            $stmt = $pdo->prepare("DELETE FROM key_value WHERE `key` = ?");
            $stmt->execute([$path]);
            
            if ($stmt->rowCount() > 0) {
                header('Content-Type: application/json');
                echo json_encode(['status' => 'success', 'message' => "Key deleted: $path"]);
            } else {
                http_response_code(404);
                header('Content-Type: application/json');
                echo json_encode(['error' => "Key not found: $path"]);
            }
        } catch (PDOException $e) {
            http_response_code(500);
            echo json_encode(['error' => 'Failed to delete key: ' . $e->getMessage()]);
        }
    }
} else {
    // Unsupported method
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
}
