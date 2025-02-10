<?php

header("Cache-Control: no-store, no-cache, must-revalidate, max-age=0");
header("Cache-Control: post-check=0, pre-check=0", false);
header("Pragma: no-cache");

// Get the target IP from the URL ip parameter. If it's not there, use client IP address.
$target_ip = $_GET['ip'] ?? ($_SERVER['HTTP_X_REAL_IP'] ?? $_SERVER['REMOTE_ADDR']);
$target_ip = htmlspecialchars($target_ip);

// Get the IP info from an external API
function getInfo($ip) {
    $ipURL = "http://ip-api.com/json/$ip?fields=17563647";
    $ipinfo = file_get_contents($ipURL);
    $ipinfo = json_decode($ipinfo, true);

    // Strip some of the more useless fields
    unset($ipinfo['status'], $ipinfo['timezone'], $ipinfo['query'], $ipinfo['lat'], $ipinfo['lon'], $ipinfo['countryCode']);

    // Remove any blank fields
    $ipinfo = array_filter($ipinfo);

    return $ipinfo;
}

function ipRange2cidr($start_ip, $end_ip) {
    $start = ip2long($start_ip);
    $end = ip2long($end_ip);
    $mask = $start ^ $end;
    $masklen = 32 - log(($mask + 1), 2);

    if (fmod($masklen, 1) < 0.0001) {
        return long2ip($start) . "/" . round($masklen);
    }
    return null;
}

// Get the IP info from the API
$intel_data = getInfo($target_ip);

// Add the target IP to the data
$intel_data['ip'] = $target_ip;

echo json_encode($intel_data);

?>
