<?php

require '/var/www/html/vendor/autoload.php';
require_once 'dotenv.php';

// Save the error log to /tmp/share_php.log
ini_set('error_log', '/tmp/share_php.log');
// Set the error reporting level
error_reporting(E_ALL);
ini_set('display_errors', 1);

// Load the .env file (default path is './.env')
$dotenv = new DotEnv();

// Get all variables as an associative array
$_ENV = $dotenv->getAll();

// Check if API key is set
if (!isset($_ENV['BREVO_KEY'])) {
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

$config = Brevo\Client\Configuration::getDefaultConfiguration()
    ->setApiKey('api-key', $_ENV['BREVO_KEY']);
$apiInstance = new Brevo\Client\Api\TransactionalEmailsApi(
    new GuzzleHttp\Client(),
    $config
);

$sendSmtpEmail = new Brevo\Client\Model\SendSmtpEmail();
$sendSmtpEmail->setSender(['email' => 'feedback@teslas.cloud', 'name' => 'teslas.cloud']);
$sendSmtpEmail->setTo([['email' => $to]]);
$sendSmtpEmail->setSubject($subject);
$sendSmtpEmail->setHtmlContent($htmlContent);
$sendSmtpEmail->setTextContent(strip_tags($htmlContent));

try {
    $result = $apiInstance->sendTransacEmail($sendSmtpEmail);
    print_r($result);
} catch (Exception $e) {
    echo 'Caught exception: ' . $e->getMessage() . "\n";
}
