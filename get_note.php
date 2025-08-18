<?php
// Return JSON with NOTE contents if present, otherwise an empty string.
// No 404s so client code doesn't trigger errors by intentionally fetching a missing file.

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

$notePath = __DIR__ . '/NOTE';
$noteText = '';

if (is_readable($notePath)) {
    // Read entire file and trim trailing whitespace
    $content = file_get_contents($notePath);
    if ($content !== false) {
        // Normalize line endings and trim
        $noteText = trim(str_replace(["\r\n", "\r"], "\n", $content));
    }
}

// Return JSON object
echo json_encode(['note' => $noteText], JSON_UNESCAPED_UNICODE);
