<?php
// Include the git info function
require_once __DIR__ . '/git_info.php';

// Get git repository information
$gitInfo = getGitInfo();

header('Content-Type: application/json');
echo json_encode([
    'commit' => $gitInfo['commit'],
    'branch' => $gitInfo['branch'],
    'tag' => $gitInfo['tag']
]);

// Eventually we should also check for a version file or similar to provide a fallback