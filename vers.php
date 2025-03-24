<?php
$gitHeadFile = __DIR__ . '/.git/HEAD';

if (file_exists($gitHeadFile)) {
    $headContent = file_get_contents($gitHeadFile);
    if (strpos($headContent, 'ref:') === 0) {
        $branchRef = trim(substr($headContent, 5));
        $branchFile = __DIR__ . '/.git/' . $branchRef;
        $branchName = basename($branchRef); // Extract branch name
        if (file_exists($branchFile)) {
            $version = substr(trim(file_get_contents($branchFile)), 0, 8); // Truncate to 8 digits
        } else {
            $version = 'unknown';
        }
    } else {
        $version = substr(trim($headContent), 0, 8); // Truncate to 8 digits
        $branchName = null;
    }

    // Check for tag name
    $tagName = null;
    $tagsOutput = [];
    exec('git describe --tags --exact-match 2>/dev/null', $tagsOutput);
    if (!empty($tagsOutput)) {
        $tagName = $tagsOutput[0];
    }
} else {
    $version = 'unknown';
    $branchName = null;
    $tagName = null;
}

header('Content-Type: application/json');
echo json_encode([
    'commit' => $version,
    'branch' => $branchName,
    'tag' => $tagName
]);

// Eventually we should also check for a version file or similar to provide a fallback