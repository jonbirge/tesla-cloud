<?php
// Include the git info function
require_once __DIR__ . '/git_info.php';

// Get git repository information
$gitInfo = getGitInfo();

// Set headers to prevent caching
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Cache-Control: post-check=0, pre-check=0', false);
header('Pragma: no-cache');
header('Expires: 0');

header('Content-Type: application/json');
echo json_encode([
    'commit' => $gitInfo['commit'],
    'branch' => $gitInfo['branch'],
    'tag' => $gitInfo['tag'],
    'diagnostic' => $gitInfo['diagnostic']
]);
