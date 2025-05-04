<?php
/**
 * Get Git repository information including commit hash, branch name, and tag
 * 
 * @return array Associative array with 'commit', 'branch', 'tag', and 'diagnostic' keys
 */
function getGitInfo() {
    $gitInfo = [
        'commit' => 'unknown',
        'branch' => null,
        'tag' => null,
        'diagnostic' => [
            'method' => 'unknown',
            'errors' => [],
            'git_available' => false
        ]
    ];
    
    // Check if git is available
    exec('which git 2>/dev/null', $output, $returnCode);
    $gitAvailable = ($returnCode === 0);
    $gitInfo['diagnostic']['git_available'] = $gitAvailable;
    
    // Add information about git version if available
    if ($gitAvailable) {
        exec('git --version 2>/dev/null', $versionOutput, $versionReturnCode);
        if ($versionReturnCode === 0 && !empty($versionOutput)) {
            $gitInfo['diagnostic']['git_version'] = trim($versionOutput[0]);
        }
    }
    
    if ($gitAvailable) {
        // Git is available, use git commands
        $gitInfo['diagnostic']['method'] = 'git_command';
        
        // Set git config to ignore ownership checks
        $gitSafeDir = 'git -c safe.directory=* ';
        
        // Get commit hash
        $result = exec($gitSafeDir . '-C ' . escapeshellarg(__DIR__) . ' rev-parse --short HEAD 2>/dev/null', $output, $returnCode);
        if ($returnCode === 0 && !empty($result)) {
            $gitInfo['commit'] = trim($result);
        } else {
            $gitInfo['diagnostic']['errors'][] = 'Failed to get commit hash using git command';
        }
        
        // Get branch name
        $result = exec($gitSafeDir . '-C ' . escapeshellarg(__DIR__) . ' rev-parse --abbrev-ref HEAD 2>/dev/null', $output, $returnCode);
        if ($returnCode === 0 && !empty($result) && $result !== 'HEAD') {
            $gitInfo['branch'] = trim($result);
        } else {
            $gitInfo['diagnostic']['errors'][] = 'Failed to get branch name using git command or detached HEAD';
        }
        
        // Get tag name (if any)
        $result = exec($gitSafeDir . '-C ' . escapeshellarg(__DIR__) . ' describe --tags --exact-match 2>/dev/null', $output, $returnCode);
        if ($returnCode === 0 && !empty($result)) {
            $gitInfo['tag'] = trim($result);
        }
        
        // If we got commit hash successfully, we can return. Otherwise fall back to file-based method
        if ($gitInfo['commit'] !== 'unknown') {
            return $gitInfo;
        }
    }
    
    // Fall back to file-based method
    $gitInfo['diagnostic']['method'] = 'file_based';
    
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
            } else {
                $gitInfo['diagnostic']['errors'][] = 'Branch ref file not found';
            }
        } else {
            // Detached HEAD state, HEAD contains the commit hash
            $gitInfo['commit'] = substr($headContent, 0, 8); // Truncate to 8 digits
        }
    } else {
        $gitInfo['diagnostic']['errors'][] = 'Git HEAD file not found';
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
    } else {
        $gitInfo['diagnostic']['errors'][] = 'Git tags directory not found';
    }

    return $gitInfo;
}
