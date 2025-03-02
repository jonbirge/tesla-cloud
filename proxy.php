<?php
if (!isset($_GET['url']) || empty($_GET['url'])) {
    die('No URL provided');
}

$url = $_GET['url'];
// Whitelist of allowed domains for security
$allowedDomains = [
    'notateslaapp.com',
];

// die if none of the allowed domains are found in the URL string anywhere
if (!preg_match('/' . implode('|', $allowedDomains) . '/i', $url)) {
    die('Invalid URL');
}

// Remove any existing headers that might interfere with framing
header_remove('X-Frame-Options');
header_remove('Content-Security-Policy');

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
curl_setopt($ch, CURLOPT_MAXREDIRS, 3);
curl_setopt($ch, CURLOPT_TIMEOUT, 30);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
curl_setopt($ch, CURLOPT_ENCODING, '');
curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language: en-US,en;q=0.5',
    'Accept-Encoding: gzip, deflate, br',
    'Connection: keep-alive',
    'DNT: 1',
    'Upgrade-Insecure-Requests: 1'
]);

$content = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$finalUrl = curl_getinfo($ch, CURLINFO_EFFECTIVE_URL);
curl_close($ch);

if ($httpCode === 200) {
    $baseUrl = parse_url($finalUrl, PHP_URL_SCHEME) . '://' . parse_url($finalUrl, PHP_URL_HOST);
    
    // Fix base URL for relative paths
    $content = preg_replace('/(href|src)=["\']\//i', '$1="' . $baseUrl . '/', $content);
    $content = preg_replace('/(href|src)=["\'](?!https?:\/\/)(?!\/)/i', '$1="' . $baseUrl . '/', $content);
    
    // Fix srcset attributes
    $content = preg_replace_callback('/srcset=["\'](.*?)["\']/i', function($matches) use ($baseUrl) {
        $srcset = $matches[1];
        $parts = explode(',', $srcset);
        foreach($parts as &$part) {
            $part = trim($part);
            if (strpos($part, 'http') !== 0) {
                if (strpos($part, '/') === 0) {
                    $url = $baseUrl . $part;
                } else {
                    $url = $baseUrl . '/' . $part;
                }
                $part = preg_replace('/^([^\s]*)(\s.*)$/', $url . '$2', $part);
            }
        }
        return 'srcset="' . implode(', ', $parts) . '"';
    }, $content);
    
    // Remove problematic headers from content
    $content = preg_replace('/<meta[^>]*http-equiv=["\']X-Frame-Options["\'][^>]*>/i', '', $content);
    $content = preg_replace('/<meta[^>]*http-equiv=["\']Content-Security-Policy["\'][^>]*>/i', '', $content);
    
    // Add base tag
    $content = preg_replace('/<head>/i', '<head><base href="' . $baseUrl . '/">', $content);
    
    echo $content;
} else {
    echo "<html><body><h1>Error accessing the page</h1><p>Failed to load content (HTTP $httpCode). Please try visiting <a href='$url'>the page</a> directly.</p></body></html>";
}
?>