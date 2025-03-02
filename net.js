function updateNetworkInfo() {
    // Write diagnostic information to the console
    console.log('Updating connection info...');

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
            // Set default values in case of error
            document.getElementById('rdns').innerText = 'N/A';
            document.getElementById('exitLocation').innerText = 'N/A';
            document.getElementById('isp').innerText = 'N/A';
        });
}

function startPingTest() {
    if (pingInterval) {
        // Stop existing test
        clearInterval(pingInterval);
        pingInterval = null;
        document.getElementById('pingTestButton').textContent = 'Restart Ping Test';
        return;
    }

    // Change button text immediately
    document.getElementById('pingTestButton').textContent = 'Stop Test';

    // Only clear data if this is a fresh start (not a restart)
    if (!pingData.length) {
        pingData = [];
        // Show the canvas
        document.getElementById('pingChart').style.display = 'block';

        // Get the Tesla blue color from CSS
        const teslaBlue = getComputedStyle(document.documentElement).getPropertyValue('--tesla-blue').trim();
        
        // Set colors based on dark mode
        const axisColor = darkOn ? '#808080' : 'var(--text-color)';
        
        // Initialize chart
        const ctx = document.getElementById('pingChart').getContext('2d');

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
                            color: darkOn ? '#808080' : 'var(--separator-color)'
                        },
                        ticks: {
                            color: axisColor,
                            font: {
                                family: 'Inter',
                                size: 14,
                                weight: 600
                            }
                        },
                        title: {
                            display: true,
                            text: 'Elapsed Time (s)',
                            color: axisColor,
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
                            color: darkOn ? '#808080' : 'var(--separator-color)'
                        },
                        ticks: {
                            color: axisColor,
                            font: {
                                family: 'Inter',
                                size: 14,
                                weight: 600
                            }
                        },
                        title: {
                            display: true,
                            text: 'Latency (ms)',
                            color: axisColor,
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
    }

    // Start pinging
    pingInterval = setInterval(pingTestServer, 1000);
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
            if (pingData.length > 61) {
                pingData.shift(); // Keep last ~60 seconds
            }
            pingChart.data.labels = Array.from({ length: pingData.length }, (_, i) => i);
            pingChart.update('none'); // Update without animation for better performance
        })
        .catch(error => {
            console.error('Ping failed:', error);
        });
}
