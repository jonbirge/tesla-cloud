<?php
// Remove any existing headers that might interfere with framing
header_remove('X-Frame-Options');
header_remove('Content-Security-Policy');

// Set up a cookie jar
$cookieJar = tempnam('/tmp', 'cookie');

// Use Today's Paper section specifically
$url = 'https://www.nytimes.com/section/todayspaper';

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
curl_setopt($ch, CURLOPT_MAXREDIRS, 3);
curl_setopt($ch, CURLOPT_TIMEOUT, 30);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
curl_setopt($ch, CURLOPT_COOKIEFILE, $cookieJar);
curl_setopt($ch, CURLOPT_COOKIEJAR, $cookieJar);
curl_setopt($ch, CURLOPT_ENCODING, '');
curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

// Add headers to make the request look more legitimate
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language: en-US,en;q=0.5',
    'Accept-Encoding: gzip, deflate, br',
    'Connection: keep-alive',
    'DNT: 1',
    'Upgrade-Insecure-Requests: 1',
    'Sec-Fetch-Dest: document',
    'Sec-Fetch-Mode: navigate',
    'Sec-Fetch-Site: none',
    'Sec-Fetch-User: ?1',
    'Cache-Control: no-cache',
    'Pragma: no-cache'
]);

$content = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$finalUrl = curl_getinfo($ch, CURLINFO_EFFECTIVE_URL);
curl_close($ch);

// Clean up cookie jar
@unlink($cookieJar);

// Only process and output content if we got a successful response
if ($httpCode === 200) {
    // Fix base URL for relative paths based on the final URL
    $baseUrl = parse_url($finalUrl, PHP_URL_SCHEME) . '://' . parse_url($finalUrl, PHP_URL_HOST);
    
    // Process the content
    $content = preg_replace('/(href|src)=["\']\//i', '$1="' . $baseUrl . '/', $content);
    $content = preg_replace('/<meta[^>]*http-equiv=["\']X-Frame-Options["\'][^>]*>/i', '', $content);
    $content = preg_replace('/<meta[^>]*http-equiv=["\']Content-Security-Policy["\'][^>]*>/i', '', $content);
    
    // Add base tag to ensure relative paths work correctly
    $content = preg_replace('/<head>/i', '<head><base href="' . $baseUrl . '/">', $content);
    
    echo $content;
} else {
    echo "<html><body><h1>Error accessing New York Times</h1><p>Failed to load content (HTTP $httpCode). Please try visiting <a href='$url'>NYTimes.com</a> directly.</p></body></html>";
}
?>
