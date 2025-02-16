<?php
// Remove any existing headers that might interfere with framing
header_remove('X-Frame-Options');
header_remove('Content-Security-Policy');

$url = 'https://www.bbc.com/news';

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
curl_setopt($ch, CURLOPT_MAXREDIRS, 3);
curl_setopt($ch, CURLOPT_TIMEOUT, 30);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
curl_setopt($ch, CURLOPT_ENCODING, '');
curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

// Add headers to make the request look more legitimate
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

// Only process and output content if we got a successful response
if ($httpCode === 200) {
    // Fix base URL for relative paths based on the final URL
    $baseUrl = parse_url($finalUrl, PHP_URL_SCHEME) . '://' . parse_url($finalUrl, PHP_URL_HOST);
    
    // Process the content
    // Fix absolute URLs that start with /
    $content = preg_replace('/(href|src)=["\']\//i', '$1="' . $baseUrl . '/', $content);
    
    // Fix relative URLs that don't start with / or http
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
    
    // Remove problematic headers
    $content = preg_replace('/<meta[^>]*http-equiv=["\']X-Frame-Options["\'][^>]*>/i', '', $content);
    $content = preg_replace('/<meta[^>]*http-equiv=["\']Content-Security-Policy["\'][^>]*>/i', '', $content);
    
    // Add base tag to ensure relative paths work correctly
    $content = preg_replace('/<head>/i', '<head><base href="' . $baseUrl . '/">', $content);
    
    echo $content;
} else {
    echo "<html><body><h1>Error accessing BBC News</h1><p>Failed to load content (HTTP $httpCode). Please try visiting <a href='$url'>BBC News</a> directly.</p></body></html>";
}
?>