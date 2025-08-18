<?php
// Return JSON with NOTE contents if present, otherwise an empty string.
// No 404s so client code doesn't trigger errors by intentionally fetching a missing file.

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

$notePath = __DIR__ . '/NOTE';
$noteText = '';
$noteMTime = null;

if (is_readable($notePath)) {
    // Read entire file and trim trailing whitespace
    $content = file_get_contents($notePath);
    if ($content !== false) {
        // Normalize line endings and trim
        $noteText = trim(str_replace(["\r\n", "\r"], "\n", $content));
    }
    // Get modification time (UNIX timestamp in seconds)
    $mtime = filemtime($notePath);
    if ($mtime !== false) {
        $noteMTime = (int)$mtime;
    }
}

// Return JSON object including modification time (or null)
echo json_encode(['note' => $noteText, 'mtime' => $noteMTime], JSON_UNESCAPED_UNICODE);
