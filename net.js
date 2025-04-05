// Import the customLog function from app.js
import { customLog } from './common.js';
import { hashedUser } from './settings.js';

// Global variables
const pingWait = 10*1000; // 10 seconds
let pingInterval = null;
let pingChart = null;
let pingData = [];
let userLocation = {
    latitude: null,
    longitude: null,
    altitude: null
};

// Get user's current geolocation coordinates
function getUserLocation() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                userLocation.latitude = position.coords.latitude;
                userLocation.longitude = position.coords.longitude;
                userLocation.altitude = position.coords.altitude || null;
                // customLog('Got user location: ', 
                //     userLocation.latitude.toFixed(4) + ', ' + 
                //     userLocation.longitude.toFixed(4) + 
                //     (userLocation.altitude ? ', alt: ' + userLocation.altitude.toFixed(1) + 'm' : ''));
            },
            (error) => {
                customLog('Error getting location: ', error.message);
            }
        );
    } else {
        customLog('Geolocation is not supported by this browser');
    }
}

// Fetches and displays network information including IP details and reverse DNS
export function updateNetworkInfo() {
    // Write diagnostic information to the console
    customLog('Updating network info...');

    // Get updated location info
    getUserLocation();

    // Get detailed IP info from ipapi.co
    fetch('https://ipapi.co/json/')
        .then(response => response.json())
        .then(ipData => {
            // Get reverse DNS using Google's public DNS API
            const ip = ipData.ip;
            // Reverse the IP address and fetch the PTR record
            const revIp = ip.split('.').reverse().join('.');
            
            return Promise.all([
                Promise.resolve(ipData),
                fetch(`https://dns.google.com/resolve?name=${revIp}.in-addr.arpa&type=PTR`)
                    .then(response => response.json())
            ]);
        })
        .then(([ipData, dnsData]) => {
            // Get the PTR record if it exists
            const rdnsName = dnsData.Answer ? dnsData.Answer[0].data : ipData.ip;
            // Update the UI with the fetched data
            document.getElementById('rdns').innerText = rdnsName;
            document.getElementById('exitLocation').innerText = `${ipData.city || 'N/A'}, ${ipData.region || 'N/A'}, ${ipData.country_name || 'N/A'}`;
            document.getElementById('isp').innerText = ipData.org || 'N/A';
        })
        .catch(error => {
            console.error('Error fetching IP/DNS information: ', error);
            customLog('Error fetching IP/DNS information: ', error);
            // Set N/A values in case of error
            document.getElementById('rdns').innerText = 'N/A';
            document.getElementById('exitLocation').innerText = 'N/A';
            document.getElementById('isp').innerText = 'N/A';
        });
}

// Initializes and starts periodic ping tests to measure network latency
export function startPingTest() {
    // Get initial location
    getUserLocation();

    // Only initialize the chart if it doesn't exist yet
    if (!pingChart) {
        pingData = [];
        initializePingChart();
    }

    // Start pinging every 5 seconds if not already running
    if (!pingInterval) {
        pingInterval = setInterval(pingTestServer, pingWait);
        
        // Run a ping immediately
        pingTestServer();
    }
}

// Cleans up the ping chart instance to prevent memory leaks
function destroyPingChart() {
    if (pingChart) {
        pingChart.destroy();
        pingChart = null;
        customLog('Ping chart destroyed');
    }
}

// Creates and configures the chart visualization for ping data
function initializePingChart() {
    // First, ensure any existing chart is destroyed
    destroyPingChart();
    
    const chartCanvas = document.getElementById('pingChart');
    if (!chartCanvas) return;

    // Get the 2D context for the chart
    const ctx = chartCanvas.getContext('2d');

    // Logging
    customLog('Initializing ping chart...');
    
    // Get the Tesla blue color from CSS
    const teslaBlue = getComputedStyle(document.documentElement).getPropertyValue('--tesla-blue').trim();
    
    // Create gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, teslaBlue + '50');  // 25% opacity at top
    gradient.addColorStop(0.5, teslaBlue + '00');  // 0% opacity at bottom
    gradient.addColorStop(1, teslaBlue + '00');  // 0% opacity at bottom
    
    pingChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Ping (ms)',
                data: pingData,
                borderColor: teslaBlue,
                borderWidth: 5,
                fill: true,
                backgroundColor: gradient,
                pointRadius: 0
            }]
        },
        options: {
            responsive: true,
            animation: true,
            scales: {
                x: {
                    type: 'linear',
                    display: true,
                    grid: {
                        color: 'black'
                    },
                    ticks: {
                        color: 'black',
                        font: {
                            family: 'Inter',
                            size: 14,
                            weight: 600
                        }
                    },
                    title: {
                        display: true,
                        text: 'Ping Count',
                        color: 'black',
                        font: {
                            family: 'Inter',
                            size: 16,
                            weight: 600
                        }
                    }
                },
                y: {
                    display: true,
                    beginAtZero: true,
                    grid: {
                        color: 'black'
                    },
                    ticks: {
                        color: 'black',
                        font: {
                            family: 'Inter',
                            size: 14,
                            weight: 600
                        }
                    },
                    title: {
                        display: true,
                        text: 'Latency (ms)',
                        color: 'black',
                        font: {
                            family: 'Inter',
                            size: 16,
                            weight: 600
                        }
                    }
                }
            },
            plugins: {
                legend: {
                    display: false
                }
            }
        }
    });

    updateChartAxisColors(); // Ensure initial colors are right

    // Logging
    customLog('Ping chart initialized');
}

// Updates chart colors based on current theme settings
export function updateChartAxisColors() {
    // Console log
    customLog('Updating chart axis colors...');

    // Get computed values from body element instead of document.documentElement
    const computedStyle = getComputedStyle(document.body);
    const axisColor = computedStyle.getPropertyValue('--button-text').trim();
    const gridColor = computedStyle.getPropertyValue('--separator-color').trim();

    // Update chart options
    if (pingChart) {
        pingChart.options.scales.x.ticks.color = axisColor;
        pingChart.options.scales.y.ticks.color = axisColor;
        pingChart.options.scales.x.grid.color = gridColor;
        pingChart.options.scales.y.grid.color = gridColor;
        pingChart.options.scales.y.title.color = axisColor;
        pingChart.options.scales.x.title.color = axisColor;
        pingChart.update();
    }
}

// Performs a ping test and records the result
async function pingTestServer() {
    // Get updated location data
    getUserLocation();

    // Prepare form data with user and location information
    const formData = new FormData();
    formData.append('user_id', hashedUser || 'anonymous');
    if (userLocation.latitude !== null) {
        formData.append('latitude', userLocation.latitude);
    }
    if (userLocation.longitude !== null) {
        formData.append('longitude', userLocation.longitude);
    }
    if (userLocation.altitude !== null) {
        formData.append('altitude', userLocation.altitude);
    }

    // Send a low-overhead HEAD request to the server
    const startTime = performance.now();
    try {
        const response = await fetch('ping.php', {
            method: 'HEAD'
        });
        
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        
        await response.text();
        const pingTime = performance.now() - startTime; // ms
        
        // Discard the first ping
        // if (!pingTestServer.firstPingDiscarded) {
        //     pingTestServer.firstPingDiscarded = true;
        //     customLog('First ping discarded: ', Math.round(pingTime));
        //     return;
        // }

        updateNetworkStatus(pingTime);

        pingData.push(pingTime);
        if (pingData.length > 100) {
            pingData.shift(); // Keep last n pings
        }

        // Only update chart if network section is visible
        const networkSection = document.getElementById('network');
        if (networkSection && networkSection.style.display === 'block' && pingChart) {
            updatePingChart(true);  // Update with animation
        }
    } catch (error) {
        customLog('Ping HEAD failed: ', error);
    }

    // Add last ping time to form data as a string
    formData.append('ping', pingData.at(-1).toFixed(1));
    try {
        const response = await fetch('ping.php', {
            method: 'POST',
            body: formData,
            cache: 'no-store'
        });

        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
    } catch (error) {
        customLog('Ping POST failed: ', error);
    }
}

// Updates the ping chart with current data, with optional animation
export function updatePingChart(animated = false) {
    if (pingChart) {
        pingChart.data.labels = Array.from({ length: pingData.length }, (_, i) => i);
        if (animated) {
            pingChart.update();
        } else {
            pingChart.update('none'); // Update without animation for better performance
        }
    }
}

// Updates the visual network status indicator based on ping latency
function updateNetworkStatus(pingTime) {
    const networkStatus = document.getElementById('network-status');
    if (!networkStatus) return;
    
    // Remove all current classes
    networkStatus.classList.remove('unavailable', 'poor', 'fair', 'good', 'excellent');
    
    // Set class based on ping time
    if (pingTime === null || pingTime > 1000) {
        networkStatus.classList.add('unavailable');
        networkStatus.setAttribute('title', 'Network Status: Poor (>500ms)');
    } else if (pingTime > 500) {
        networkStatus.classList.add('poor');
        networkStatus.setAttribute('title', `Network Status: Poor (${Math.round(pingTime)}ms)`);
    } else if (pingTime > 250) {
        networkStatus.classList.add('fair');
        networkStatus.setAttribute('title', `Network Status: Fair (${Math.round(pingTime)}ms)`);
    } else if (pingTime > 50) {
        networkStatus.classList.add('good');
        networkStatus.setAttribute('title', `Network Status: Good (${Math.round(pingTime)}ms)`);
    } else {
        networkStatus.classList.add('excellent');
        networkStatus.setAttribute('title', `Network Status: Excellent (${Math.round(pingTime)}ms)`);
    }
}

// Stops the automatic ping testing
window.pausePingTest = function() {
    if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
        customLog('Network ping testing paused');
    }
}

// Resumes automatic ping testing
window.resumePingTest = function() {
    if (!pingInterval) {
        // Ping the server immediately
        pingTestServer();
        // Resume pinging every 10 seconds
        pingInterval = setInterval(pingTestServer, pingWait);
        customLog('Network ping testing resumed');
    }
}

// Initialize the firstPingDiscarded flag
// pingTestServer.firstPingDiscarded = false;
