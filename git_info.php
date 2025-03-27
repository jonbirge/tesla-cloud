<?php
/**
 * Get Git repository information including commit hash, branch name, and tag
 * 
 * @return array Associative array with 'commit', 'branch', and 'tag' keys
 */
function getGitInfo() {
    $gitInfo = [
        'commit' => 'unknown',
        'branch' => null,
        'tag' => null
    ];

    // Get commit hash from refs file
    $gitRefsFile = __DIR__ . '/.git/info/refs';
    if (file_exists($gitRefsFile)) {
        $headContent = file($gitRefsFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        if (!empty($headContent)) {
            $gitInfo['commit'] = substr(trim($headContent[0]), 0, 8); // Truncate to 8 digits
        }
    }

    // Get branch name
    $gitHeadFile = __DIR__ . '/.git/HEAD';
    if (file_exists($gitHeadFile)) {
        $headContent = file($gitHeadFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        if (!empty($headContent)) {
            if (strpos($headContent[0], 'ref:') === 0) {
                $gitInfo['branch'] = trim(str_replace('ref: refs/heads/', '', $headContent[0]));
            }
        }
    }

    // Check for tag name
    $tagsOutput = [];
    exec('git describe --tags --exact-match 2>/dev/null', $tagsOutput);
    if (!empty($tagsOutput)) {
        $gitInfo['tag'] = $tagsOutput[0];
    }

    return $gitInfo;
}