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

    // Get commit hash and branch name from .git/HEAD
    $gitHeadFile = __DIR__ . '/.git/HEAD';
    if (file_exists($gitHeadFile)) {
        $headContent = trim(file_get_contents($gitHeadFile));
        if (strpos($headContent, 'ref:') === 0) {
            // HEAD points to a branch
            $branchName = str_replace('ref: refs/heads/', '', $headContent);
            $gitInfo['branch'] = $branchName;

            // Resolve branch to commit hash
            $branchRefFile = __DIR__ . '/.git/refs/heads/' . $branchName;
            if (file_exists($branchRefFile)) {
                $gitInfo['commit'] = substr(trim(file_get_contents($branchRefFile)), 0, 8);
            }
        } else {
            // Detached HEAD state, HEAD contains the commit hash
            $gitInfo['commit'] = substr($headContent, 0, 8); // Truncate to 8 digits
        }
    }

    // Check for tag name
    $gitTagsDir = __DIR__ . '/.git/refs/tags/';
    if (is_dir($gitTagsDir)) {
        $tags = scandir($gitTagsDir);
        foreach ($tags as $tag) {
            if ($tag === '.' || $tag === '..') {
                continue;
            }
            $tagRefFile = $gitTagsDir . $tag;
            if (file_exists($tagRefFile) && substr(trim(file_get_contents($tagRefFile)), 0, 8) === $gitInfo['commit']) {
                $gitInfo['tag'] = $tag;
                break;
            }
        }
    }

    return $gitInfo;
}
