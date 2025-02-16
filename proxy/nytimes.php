<?php
header('X-Frame-Options: SAMEORIGIN');

// Basic security: only allow requests from our domain
// $allowed_referer = 'teslas.cloud';
// if (!isset($_SERVER['HTTP_REFERER']) || 
//     !strpos($_SERVER['HTTP_REFERER'], $allowed_referer)) {
//     die('Unauthorized access');
// }

// Fetch NY Times content
$url = 'https://www.nytimes.com/section/todayspaper';
$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
$content = curl_exec($ch);
curl_close($ch);

// Process the content to fix relative URLs and remove frame-blocking headers
$content = preg_replace('/(href|src)=["\']\//i', '$1="https://www.nytimes.com/', $content);
$content = preg_replace('/<meta[^>]*http-equiv=["\']X-Frame-Options["\'][^>]*>/i', '', $content);

// Output the modified content
echo $content;
?>
