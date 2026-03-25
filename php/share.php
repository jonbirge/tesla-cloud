<?php

header('Content-Type: application/json');

require_once 'dotenv.php';

error_reporting(E_ALL);
ini_set('display_errors', 0);

// GET request: return diagnostic page
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    header('Content-Type: text/html; charset=utf-8');

    $diag = [];
    $diag['timestamp'] = date('Y-m-d H:i:s T');
    $diag['php_version'] = phpversion();
    $diag['script_path'] = __FILE__;
    $diag['server_software'] = $_SERVER['SERVER_SOFTWARE'] ?? 'unknown';

    // Check autoload / Brevo SDK
    $autoloadPath = '/var/www/html/vendor/autoload.php';
    $diag['autoload_path'] = $autoloadPath;
    $diag['autoload_exists'] = file_exists($autoloadPath);
    if ($diag['autoload_exists']) {
        require $autoloadPath;
        $diag['brevo_sdk_loaded'] = class_exists('Brevo\Client\Configuration');
    } else {
        $diag['brevo_sdk_loaded'] = false;
    }

    // Check .env
    $envPath = __DIR__ . '/../.env';
    $diag['env_path'] = $envPath;
    $diag['env_exists'] = file_exists($envPath);
    $diag['brevo_key_set'] = false;
    $diag['brevo_key_length'] = 0;
    $diag['brevo_key_prefix'] = '';

    if ($diag['env_exists']) {
        $dotenv = new DotEnv($envPath);
        $_ENV = $dotenv->getAll();
        $diag['env_keys'] = array_keys($_ENV);
        if (isset($_ENV['BREVO_KEY'])) {
            $diag['brevo_key_set'] = true;
            $diag['brevo_key_length'] = strlen($_ENV['BREVO_KEY']);
            $diag['brevo_key_prefix'] = substr($_ENV['BREVO_KEY'], 0, 8) . '...';
        }
    }

    // Try Brevo API connectivity
    $diag['brevo_api_test'] = 'skipped';
    $diag['brevo_api_detail'] = '';
    if ($diag['brevo_sdk_loaded'] && $diag['brevo_key_set']) {
        try {
            $config = Brevo\Client\Configuration::getDefaultConfiguration()
                ->setApiKey('api-key', $_ENV['BREVO_KEY']);
            $accountApi = new Brevo\Client\Api\AccountApi(
                new GuzzleHttp\Client(),
                $config
            );
            $account = $accountApi->getAccount();
            $diag['brevo_api_test'] = 'success';
            $diag['brevo_account_email'] = $account->getEmail();
            $plan = $account->getPlan();
            if ($plan && count($plan) > 0) {
                $diag['brevo_plan'] = $plan[0]->getType();
                $diag['brevo_credits'] = $plan[0]->getCredits();
            }
        } catch (Brevo\Client\ApiException $e) {
            $diag['brevo_api_test'] = 'failed';
            $body = $e->getResponseBody();
            $decoded = is_string($body) ? json_decode($body, true) : $body;
            $diag['brevo_api_detail'] = $decoded['message'] ?? $e->getMessage();
            $diag['brevo_api_http_code'] = $e->getCode();
        } catch (Exception $e) {
            $diag['brevo_api_test'] = 'error';
            $diag['brevo_api_detail'] = get_class($e) . ': ' . $e->getMessage();
        }
    } elseif (!$diag['brevo_sdk_loaded']) {
        $diag['brevo_api_test'] = 'skipped — SDK not loaded';
    } else {
        $diag['brevo_api_test'] = 'skipped — BREVO_KEY not set';
    }

    // Render HTML diagnostic page
    $ok = '&#9989;';
    $fail = '&#10060;';
    $warn = '&#9888;&#65039;';

    echo '<!DOCTYPE html><html><head><meta charset="utf-8">';
    echo '<title>share.php diagnostics</title>';
    echo '<style>
        body { font-family: monospace; background: #1a1a2e; color: #e0e0e0; padding: 2em; max-width: 900px; margin: 0 auto; }
        h1 { color: #8be9fd; }
        h2 { color: #bd93f9; margin-top: 1.5em; }
        .check { margin: 0.3em 0; }
        .ok { color: #50fa7b; }
        .fail { color: #ff5555; }
        .warn { color: #f1fa8c; }
        pre { background: #0d0d1a; padding: 1em; border-radius: 6px; overflow-x: auto; font-size: 0.85em; max-height: 400px; overflow-y: auto; }
        table { border-collapse: collapse; width: 100%; }
        td { padding: 4px 12px; vertical-align: top; }
        td:first-child { color: #8be9fd; white-space: nowrap; }
    </style></head><body>';

    echo '<h1>share.php — Diagnostics</h1>';

    // Environment
    echo '<h2>Environment</h2><table>';
    echo "<tr><td>Timestamp</td><td>{$diag['timestamp']}</td></tr>";
    echo "<tr><td>PHP Version</td><td>{$diag['php_version']}</td></tr>";
    echo "<tr><td>Server</td><td>{$diag['server_software']}</td></tr>";
    echo "<tr><td>Script Path</td><td>{$diag['script_path']}</td></tr>";
    echo '</table>';

    // Dependencies
    echo '<h2>Dependencies</h2>';
    $s = $diag['autoload_exists'] ? 'ok' : 'fail';
    $i = $diag['autoload_exists'] ? $ok : $fail;
    echo "<div class='check $s'>$i vendor/autoload.php — {$diag['autoload_path']}</div>";
    $s = $diag['brevo_sdk_loaded'] ? 'ok' : 'fail';
    $i = $diag['brevo_sdk_loaded'] ? $ok : $fail;
    echo "<div class='check $s'>$i Brevo SDK class loaded</div>";

    // Configuration
    echo '<h2>Configuration</h2>';
    $s = $diag['env_exists'] ? 'ok' : 'fail';
    $i = $diag['env_exists'] ? $ok : $fail;
    echo "<div class='check $s'>$i .env file — {$diag['env_path']}</div>";
    if ($diag['env_exists']) {
        echo "<div class='check'>&nbsp;&nbsp;Keys: " . implode(', ', $diag['env_keys'] ?? []) . "</div>";
    }
    $s = $diag['brevo_key_set'] ? 'ok' : 'fail';
    $i = $diag['brevo_key_set'] ? $ok : $fail;
    $keyInfo = $diag['brevo_key_set'] ? "{$diag['brevo_key_prefix']} ({$diag['brevo_key_length']} chars)" : 'not set';
    echo "<div class='check $s'>$i BREVO_KEY — $keyInfo</div>";

    // API Test
    echo '<h2>Brevo API Connection Test</h2>';
    if ($diag['brevo_api_test'] === 'success') {
        echo "<div class='check ok'>$ok Connected — account: {$diag['brevo_account_email']}</div>";
        if (isset($diag['brevo_plan'])) {
            echo "<div class='check'>&nbsp;&nbsp;Plan: {$diag['brevo_plan']} — Credits: {$diag['brevo_credits']}</div>";
        }
    } elseif ($diag['brevo_api_test'] === 'failed') {
        echo "<div class='check fail'>$fail API returned error (HTTP {$diag['brevo_api_http_code']}): " . htmlspecialchars($diag['brevo_api_detail']) . "</div>";
    } elseif ($diag['brevo_api_test'] === 'error') {
        echo "<div class='check fail'>$fail Exception: " . htmlspecialchars($diag['brevo_api_detail']) . "</div>";
    } else {
        echo "<div class='check warn'>$warn " . htmlspecialchars($diag['brevo_api_test']) . "</div>";
    }

    echo '</body></html>';
    exit;
}

// Only allow POST requests beyond this point
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'error' => 'Method Not Allowed']);
    exit;
}

// Check that the Brevo SDK is available
$autoloadPath = '/var/www/html/vendor/autoload.php';
if (!file_exists($autoloadPath)) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'Server dependency missing (vendor/autoload.php)']);
    exit;
}
require $autoloadPath;

// Load the .env file (default path is './.env')
$envPath = __DIR__ . '/../.env';
$dotenv = new DotEnv($envPath);

// Get all variables as an associative array
$_ENV = $dotenv->getAll();

// Check if API key is set
if (!isset($_ENV['BREVO_KEY'])) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'Mail API key not configured on server']);
    exit;
}

// Parse JSON payload
$rawInput = file_get_contents('php://input');
$input = json_decode($rawInput, true);

if (json_last_error() !== JSON_ERROR_NONE) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Invalid JSON: ' . json_last_error_msg()]);
    exit;
}

if (!$input || !isset($input['to']) || !isset($input['html'])) {
    $missing = [];
    if (!isset($input['to']))   $missing[] = 'to';
    if (!isset($input['html'])) $missing[] = 'html';
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Missing required fields: ' . implode(', ', $missing)]);
    exit;
}

// Validate email address format
$to = trim($input['to']);
if (!filter_var($to, FILTER_VALIDATE_EMAIL)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Invalid email address format: ' . $to]);
    exit;
}

// TODO: Get e-mail address from settings database by passing in hashed user ID
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
    $messageId = method_exists($result, 'getMessageId') ? $result->getMessageId() : null;
    echo json_encode([
        'success' => true,
        'messageId' => $messageId,
        'to' => $to,
        'subject' => $subject,
    ]);
} catch (Brevo\Client\ApiException $e) {
    $responseBody = $e->getResponseBody();
    $decoded = is_string($responseBody) ? json_decode($responseBody, true) : $responseBody;
    $brevoMessage = $decoded['message'] ?? ($decoded['error'] ?? $e->getMessage());
    $statusCode = $e->getCode();
    http_response_code(502);
    echo json_encode([
        'success' => false,
        'error' => 'Mail service error: ' . $brevoMessage,
        'statusCode' => $statusCode,
        'detail' => $decoded,
    ]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => 'Unexpected server error: ' . $e->getMessage(),
        'exceptionType' => get_class($e),
    ]);
}
