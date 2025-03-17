function updateNetworkInfo() {
    // Write diagnostic information to the console
    customLog('Updating network info...');

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
            // Set default values in case of error
            document.getElementById('rdns').innerText = 'N/A';
            document.getElementById('exitLocation').innerText = 'N/A';
            document.getElementById('isp').innerText = 'N/A';
        });
}

function startPingTest() {
    // Only initialize the chart if it doesn't exist yet
    if (!pingChart) {
        pingData = [];
        initializePingChart();
    }

    // Start pinging every 5 seconds if not already running
    if (!pingInterval) {
        pingInterval = setInterval(pingTestServer, 5000);
        
        // Run a ping immediately
        pingTestServer();
    }
}

function initializePingChart() {
    const chartCanvas = document.getElementById('pingChart');
    if (!chartCanvas) return;

    // Logging
    customLog('Initializing ping chart...');
    
    // Get the Tesla blue color from CSS
    const teslaBlue = getComputedStyle(document.documentElement).getPropertyValue('--tesla-blue').trim();
    
    const ctx = chartCanvas.getContext('2d');

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
}

function updateChartAxisColors() {
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

function pingTestServer() {
    const startTime = performance.now();
    fetch('ping.php', { 
        cache: 'no-store',
        method: 'HEAD'  // Only get headers, we don't need content
    })
        .then(() => {
            const pingTime = performance.now() - startTime;
            pingData.push(pingTime);
            if (pingData.length > 100) {
                pingData.shift(); // Keep last n pings
            }

            // Logging
            customLog('Ping time: ', pingTime);
            
            // Always update network status indicator
            updateNetworkStatus(pingTime);
            
            // Only update chart if network section is visible
            const networkSection = document.getElementById('network');
            if (networkSection && networkSection.style.display === 'block' && pingChart) {
                pingChart.data.labels = Array.from({ length: pingData.length }, (_, i) => i);
                pingChart.update('none'); // Update without animation for better performance
            }
        })
        .catch(error => {
            console.error('Ping failed:', error);
            customLog('Ping failed:', error);
            // Update network status to unavailable on error
            updateNetworkStatus(null);
        });
}

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
    } else if (pingTime > 75) {
        networkStatus.classList.add('good');
        networkStatus.setAttribute('title', `Network Status: Good (${Math.round(pingTime)}ms)`);
    } else {
        networkStatus.classList.add('excellent');
        networkStatus.setAttribute('title', `Network Status: Excellent (${Math.round(pingTime)}ms)`);
    }
}

// Start ping test automatically when page loads
document.addEventListener('DOMContentLoaded', function() {
    startPingTest();
});
