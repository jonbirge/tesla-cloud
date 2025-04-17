<?php
require '/var/www/html/vendor/autoload.php';

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
if (!isset($_ENV['SENDGRID_KEY'])) {
    http_response_code(500);
    echo json_encode(['error' => 'API key not found in .env file']);
    exit;
}

// Only allow POST requests
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo 'Method Not Allowed';
    exit;
}

// Parse JSON payload
$input = json_decode(file_get_contents('php://input'), true);
if (!$input || !isset($input['to']) || !isset($input['html'])) {
    http_response_code(400);
    echo 'Invalid payload';
    exit;
}

// TODO: Get e-mail address from settings database by passing in hashed user ID
$to = $input['to'];
$subject = $input['subject'] ?? 'Article forwarded from teslas.cloud';
$htmlContent = $input['html'];

$email = new \SendGrid\Mail\Mail(); 
$email->setFrom("feedback@birgefuller.com", "Birge & Fuller, LLC");
$email->setSubject($subject);
$email->addTo($to);
$email->addContent("text/plain", strip_tags($htmlContent));
$email->addContent("text/html", $htmlContent);
$sendgrid = new \SendGrid($_ENV['SENDGRID_KEY']);
try {
    $response = $sendgrid->send($email);
    print $response->statusCode() . "\n";
    print_r($response->headers());
    print $response->body() . "\n";
} catch (Exception $e) {
    echo 'Caught exception: '. $e->getMessage() ."\n";
}
