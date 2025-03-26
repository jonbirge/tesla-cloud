<?php
$gitRefsFile = __DIR__ . '/.git/info/refs';

if (file_exists($gitRefsFile)) {
    $headContent = file($gitRefsFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    if (!empty($headContent)) {
        $version = substr(trim($headContent[0]), 0, 8); // Truncate to 8 digits
    } else {
        $version = 'unknown';
    }
} else {
    $version = 'unknown';
}

$gitHeadFile = __DIR__ . '/.git/HEAD';

if (file_exists($gitHeadFile)) {
    $headContent = file($gitHeadFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    if (!empty($headContent)) {
        if (strpos($headContent[0], 'ref:') === 0) {
            $branchName = trim(str_replace('ref: refs/heads/', '', $headContent[0]));
        } else {
            $branchName = null;
        }
    } else {
        $branchName = null;
    }
} else {
    $branchName = null;
}

// Check for tag name
$tagName = null;
$tagsOutput = [];
exec('git describe --tags --exact-match 2>/dev/null', $tagsOutput);
if (!empty($tagsOutput)) {
    $tagName = $tagsOutput[0];
}

header('Content-Type: application/json');
echo json_encode([
    'commit' => $version,
    'branch' => $branchName,
    'tag' => $tagName
]);

// Eventually we should also check for a version file or similar to provide a fallback