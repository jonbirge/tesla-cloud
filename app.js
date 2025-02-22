// Settings
const locUpdateInterval = 10; // seconds
const locDataUpdateInterval = 120; // seconds

// Global variables
let lastUpdate = 0;
let neverUpdatedLocation = true;
let lat = null;
let long = null;
let alt = null;
let sunrise = null;
let sunset = null;
let moonPhaseData = null;
let pingChart = null;
let pingInterval = null;
let pingData = [];
let manualDarkMode = false;
let darkOn = false;
let locationTimeZone = null;
let weatherData = null;
let forecastFetched = false;

function toggleMode() {
    manualDarkMode = true;
    document.body.classList.toggle('dark-mode');
    darkOn = document.body.classList.contains('dark-mode');
    document.getElementById('darkModeToggle').checked = darkOn;
}

async function updateLocationData() {
    if (lat !== null && long !== null) {
        console.log('Updating location dependent data...');
        neverUpdatedLocation = false;

        // Update local weather link
        const weatherLink = document.getElementById("localWeather");
        if (weatherLink) {
            weatherLink.href = `https://forecast.weather.gov/MapClick.php?lat=${lat}&lon=${long}`;
        }

        // Fire off API requests for external data
        locationTimeZone = await fetchTimeZone(lat, long);
        console.log('Timezone: ', locationTimeZone);
        fetchCityData(lat, long);
        fetchSunData(lat, long);
        
        // Update the weather section if it's visible
        const weatherSection = document.getElementById("weather");
        if (weatherSection.style.display === "block") {
            fetchWeatherData(lat, long);
        }

        // Update connectivity data if the Connectivity section is visible
        const connectivitySection = document.getElementById("connectivity");
        if (connectivitySection.style.display === "block") {
            updateConnectionInfo();
        }

        // Update Wikipedia data if the Location section is visible
        const locationSection = document.getElementById("location");
        if (locationSection.style.display === "block") {
            fetchWikipediaData(lat, long);
        }
    } else {
        console.log('Location not available for dependent data.');
    }
}

function updateLatLong() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((position) => {
            lat = position.coords.latitude;
            long = position.coords.longitude;
            alt = position.coords.altitude;  // altitude in meters
            console.log(`Updating location: ${lat}, ${long}, ${alt}`);

            // Handle first update to ensure timely data
            if (neverUpdatedLocation) {
                updateLocationData();
            }
            
            // Update location display
            document.getElementById('latitude').innerText = lat.toFixed(4) + '°';
            document.getElementById('longitude').innerText = long.toFixed(4) + '°';

            // Update altitude in meters and feet
            const altStr = alt ? `${alt.toFixed(0)} m, ${(alt * 3.28084).toFixed(0)} ft` : 'N/A';
            document.getElementById('altitude').innerText = altStr;

            // Update time id element
            document.getElementById('time').innerText = new Date().toLocaleTimeString('en-US', { 
                timeZone: locationTimeZone || 'UTC',
                timeZoneName: 'short' // 'PDT', 'EDT', etc.
            });
        });
    } else {
        console.log('Geolocation is not supported by this browser.');
    }
}

function fetchCityData(lat, long) {
    // Proxy request to Geonames reverse geocoding API endpoint
    fetch(`https://secure.geonames.org/findNearbyPlaceNameJSON?lat=${lat}&lng=${long}&username=birgefuller`)
        .then(response => response.json())
        .then(cityData => {
            const place = cityData.geonames && cityData.geonames[0];
            document.getElementById('city').innerText =
                (place ? (place.name || 'N/A') + ', ' + (place.adminName1 || 'N/A') : 'N/A');
        })
        .catch(error => {
            console.error('Error fetching city data:', error);
        });
}

async function fetchTimeZone(lat, long) {
    try {
        const response = await fetch(`https://secure.geonames.org/timezoneJSON?lat=${lat}&lng=${long}&username=birgefuller`);
        const tzData = await response.json();
        return tzData.timezoneId || 'UTC';
    } catch (error) {
        console.error('Error fetching time zone:', error);
        return 'UTC';
    }
}

function fetchSunData(lat, long) {
    Promise.all([
        fetch(`https://api.sunrise-sunset.org/json?lat=${lat}&lng=${long}&formatted=0`),
        fetch(`https://api.farmsense.net/v1/moonphases/?d=${Math.floor(Date.now() / 1000)}`)
    ])
        .then(([sunResponse, moonResponse]) => Promise.all([sunResponse.json(), moonResponse.json()]))
        .then(([sunData, moonData]) => {
            // console.log('Sun data:', sunData);
            sunrise = sunData.results.sunrise;
            sunset = sunData.results.sunset;
            moonPhaseData = moonData[0];
            
            const sunriseElements = document.querySelectorAll('[id="sunrise"]');
            const sunsetElements = document.querySelectorAll('[id="sunset"]');
            const moonphaseElements = document.querySelectorAll('[id="moonphase"]');
            
            sunriseElements.forEach(element => {
                element.innerText = new Date(sunrise).toLocaleTimeString('en-US', {
                    timeZone: locationTimeZone || 'UTC',
                    timeZoneName: 'short'
                });
            });
            sunsetElements.forEach(element => {
                element.innerText = new Date(sunset).toLocaleTimeString('en-US', {
                    timeZone: locationTimeZone || 'UTC',
                    timeZoneName: 'short'
                });
            });
            moonphaseElements.forEach(element => {
                element.innerText = getMoonPhaseName(moonPhaseData.Phase);
            });
            
            // Automatically apply dark mode based on the local time
            updateAutoDarkMode();
        })
        .catch(error => {
            console.error('Error fetching sun/moon data: ', error);
        });
}

function getMoonPhaseName(phase) {
    // Convert numerical phase to human-readable name
    if (phase === 0 || phase === 1) return "New Moon";
    if (phase < 0.25) return "Waxing Crescent";
    if (phase === 0.25) return "First Quarter";
    if (phase < 0.5) return "Waxing Gibbous";
    if (phase === 0.5) return "Full Moon";
    if (phase < 0.75) return "Waning Gibbous";
    if (phase === 0.75) return "Last Quarter";
    return "Waning Crescent";
}

function updateAutoDarkMode() {
    if (!manualDarkMode && lat !== null && long !== null) {
        const now = new Date();
        const currentTime = now.getTime();
        const sunriseTime = new Date(sunrise).getTime();
        const sunsetTime = new Date(sunset).getTime();

        if (currentTime >= sunsetTime || currentTime < sunriseTime) {
            console.log('Applying dark mode based on sunset...');
            document.body.classList.add('dark-mode');
            darkOn = true;
            document.getElementById('darkModeToggle').checked = true;
        } else {
            console.log('Applying light mode based on sunrise...');
            document.body.classList.remove('dark-mode');
            darkOn = false;
            document.getElementById('darkModeToggle').checked = false;
        }
    } else {
        console.log('Location not available for auto dark mode.');
    }
}

function updateConnectionInfo() {
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
            document.getElementById('location').innerText = `${ipData.city || 'N/A'}, ${ipData.region || 'N/A'}, ${ipData.country_name || 'N/A'}`;
            document.getElementById('isp').innerText = ipData.org || 'N/A';
        })
        .catch(error => {
            console.error('Error fetching IP/DNS information: ', error);
            // Set default values in case of error
            document.getElementById('rdns').innerText = 'N/A';
            document.getElementById('location').innerText = 'N/A';
            document.getElementById('isp').innerText = 'N/A';
        });
}

const WEATHER_IMAGES = {
    latest: 'https://cdn.star.nesdis.noaa.gov/GOES16/GLM/CONUS/EXTENT3/1250x750.jpg',
    loop: 'https://cdn.star.nesdis.noaa.gov/GOES16/GLM/CONUS/EXTENT3/GOES16-CONUS-EXTENT3-625x375.gif'
};

function showSection(sectionId) {
    // Log the clicked section
    console.log(`Showing section: ${sectionId}`);

    // First, restore original content if we're in external mode
    const rightFrame = document.getElementById('rightFrame');
    if (rightFrame.classList.contains('external')) {
        rightFrame.innerHTML = rightFrame.getAttribute('data-original-content');
        rightFrame.removeAttribute('data-original-content');
        rightFrame.classList.remove('external');
    }

    // Then get a fresh reference to sections after DOM is restored
    const sections = document.querySelectorAll('.section');
    sections.forEach(section => {
        section.style.display = 'none';
    });

    // Deactivate all buttons
    const buttons = document.querySelectorAll('.section-button');
    buttons.forEach(button => {
        button.classList.remove('active');
    });

    // Show the selected section
    const section = document.getElementById(sectionId);
    if (section) {
        section.style.display = 'block';
        
        if (sectionId === 'weather') {
            // Load weather image when weather section is shown
            const weatherImage = document.getElementById('weather-image');
            weatherImage.src = WEATHER_IMAGES.latest;
            // Load latest weather data
            if (lat !== null && long !== null) {
                fetchWeatherData(lat, long);
            } else {
                console.log('Location not available to fetch weather data.');
            }
        } else {
            // Remove weather img src to force reload when switching back
            const weatherImage = document.getElementById('weather-image');
            if (weatherImage) {
                weatherImage.src = '';
            }
        }

        if (sectionId === 'connectivity') {
            const now = Date.now();
            if (now - lastUpdate > 60000) { // 60 seconds
                updateConnectionInfo();
                lastUpdate = now;
            } else {
                console.log('Skipping update, too soon...');
            }
        }
		
        if (sectionId === 'location') {
            if (lat !== null && long !== null) {
                fetchWikipediaData(lat, long);
            } else {
                console.log('Location not available to fetch Wikipedia data.');
            }
        }
    }

    // Activate the clicked button
    const button = document.querySelector(`.section-button[onclick="showSection('${sectionId}')"]`);
    if (button) {
        button.classList.add('active');
    }
}

async function fetchWikipediaData(lat, long) {
    console.log('Fetching Wikipedia data...');
    const url = `https://secure.geonames.org/findNearbyWikipediaJSON?lat=${lat}&lng=${long}&username=birgefuller`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        const wikiDiv = document.getElementById('wikipediaInfo');
        if (data.geonames && data.geonames.length > 0) {
            let html = '<ul>';
            data.geonames.forEach(article => {
                // Ensure URL starts with http:// for proper linking
                const pageUrl = article.wikipediaUrl.startsWith('http') ? article.wikipediaUrl : 'http://' + article.wikipediaUrl;
                html += `<li><a href="${pageUrl}" target="_blank">${article.title}</a>: ${article.summary}</li>`;
            });
            html += '</ul>';
            wikiDiv.innerHTML = html;
        } else {
            wikiDiv.innerHTML = '<p><em>No nearby Wikipedia articles found.</em></p>';
        }
    } catch (error) {
        console.error('Error fetching Wikipedia data:', error);
        document.getElementById('wikipediaInfo').innerHTML = '<p><em>Error loading Wikipedia data.</em></p>';
    }
}

function startPingTest() {
    if (pingInterval) {
        // Stop existing test
        clearInterval(pingInterval);
        pingInterval = null;
        document.getElementById('pingTestButton').textContent = 'Start Ping Test';
        return;
    }

    // Clear previous data
    pingData = [];
    
    // Show the canvas
    document.getElementById('pingChart').style.display = 'block';

    // Get the Tesla blue color from CSS
    const teslaBlue = getComputedStyle(document.documentElement).getPropertyValue('--tesla-blue').trim();
    
    // Set colors based on dark mode
    const axisColor = darkOn ? '#808080' : 'var(--text-color)';
    
    // Initialize chart
    const ctx = document.getElementById('pingChart').getContext('2d');
    pingChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Ping (ms)',
                data: pingData,
                borderColor: teslaBlue,
                borderWidth: 3,
                fill: false,
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
                        text: 'Time (seconds)',
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
                        text: 'Ping (ms)',
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

    // Start pinging
    document.getElementById('pingTestButton').textContent = 'Stop Test';
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
            if (pingData.length > 60) {
                pingData.shift(); // Keep last 60 seconds
            }
            pingChart.data.labels = Array.from({ length: pingData.length }, (_, i) => i);
            pingChart.update('none'); // Update without animation for better performance
        })
        .catch(error => {
            console.error('Ping failed:', error);
        });
}

function switchWeatherImage(type) {
    const weatherImage = document.getElementById('weather-image');
    weatherImage.style.opacity = '0';
    
    setTimeout(() => {
        weatherImage.src = WEATHER_IMAGES[type];
        weatherImage.style.opacity = '1';
    }, 300);
    
    // Update buttons and slider position
    const weatherSwitch = document.querySelector('.weather-switch');
    const buttons = weatherSwitch.getElementsByTagName('button');
    buttons[0].classList.toggle('active', type === 'latest');
    buttons[1].classList.toggle('active', type === 'loop');
    
    // Update slider position with just 0 or 1
    weatherSwitch.style.setProperty('--slider-position', type === 'latest' ? '0' : '1');
}

function fetchWeatherData(lat, long) {
    console.log('Fetching weather data...');
    Promise.all([
        fetch(`https://secure.geonames.org/findNearByWeatherJSON?lat=${lat}&lng=${long}&username=birgefuller`),
        !forecastFetched ? fetch(`https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${long}&appid=6a1b1bcb03b5718a9b3a2b108ce3293d&units=imperial`) : Promise.resolve(null)
    ])
        .then(([currentResponse, forecastResponse]) => Promise.all([
            currentResponse.json(),
            forecastResponse ? forecastResponse.json() : null
        ]))
        .then(([currentData, forecastData]) => {
            if (currentData.weatherObservation) {
                weatherData = currentData.weatherObservation;
                updateWeatherDisplay();
            }
            
            if (forecastData && !forecastFetched) {
                updateForecastDisplay(forecastData);
                forecastFetched = true;
            }
        })
        .catch(error => {
            console.error('Error fetching weather data: ', error);
        });
}

function updateForecastDisplay(data) {
    const forecastDays = document.querySelectorAll('.forecast-day');
    const dailyData = extractDailyForecast(data.list);
    
    dailyData.forEach((day, index) => {
        if (index < forecastDays.length) {
            const date = new Date(day.dt * 1000);
            const dayElement = forecastDays[index];
            
            dayElement.querySelector('.forecast-date').textContent = 
                date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
            
            dayElement.querySelector('.forecast-icon').src = 
                `https://openweathermap.org/img/wn/${day.weather[0].icon}@2x.png`;
            
            dayElement.querySelector('.forecast-temp').textContent = 
                `${Math.round(day.temp_min)}°/${Math.round(day.temp_max)}°`;
            
            dayElement.querySelector('.forecast-desc').textContent = 
                day.weather[0].main;
        }
    });
}

function extractDailyForecast(forecastList) {
    const dailyData = [];
    const dayMap = new Map();
    
    forecastList.forEach(item => {
        const date = new Date(item.dt * 1000).toDateString();
        
        if (!dayMap.has(date)) {
            dayMap.set(date, {
                dt: item.dt,
                temp_min: item.main.temp_min,
                temp_max: item.main.temp_max,
                weather: item.weather
            });
        } else {
            const existing = dayMap.get(date);
            existing.temp_min = Math.min(existing.temp_min, item.main.temp_min);
            existing.temp_max = Math.max(existing.temp_max, item.main.temp_max);
        }
    });
    
    dayMap.forEach(day => dailyData.push(day));
    return dailyData.slice(0, 5);
}

function updateWeatherDisplay() {
    if (!weatherData) return;

    const tempC = weatherData.temperature;
    const tempF = (tempC * 9/5 + 32).toFixed(1);
    const humidity = weatherData.humidity;
    const windSpeedMS = weatherData.windSpeed;
    const windSpeedMPH = (windSpeedMS * 2.237).toFixed(1); // Convert m/s to mph
    const windDir = weatherData.windDirection;
    const dewPointC = weatherData.dewPoint;
    const dewPointF = (dewPointC * 9/5 + 32).toFixed(1);

    document.getElementById('temperature').innerText = `${tempF}°F (${tempC}°C)`;
    document.getElementById('humidity').innerText = `${humidity}%`;
    document.getElementById('wind').innerText = `${windSpeedMPH} mph at ${windDir}°`;
    document.getElementById('dewpoint').innerText = `${dewPointF}°F (${dewPointC}°C)`;
}

function loadExternalUrl(url, inFrame = false) {
    // Open external links in a new tab
    if (!inFrame) {
        window.open(url, '_blank');
        return;
    }

    // Load external content in the right frame
    const rightFrame = document.getElementById('rightFrame');
    
    // Store current content
    if (!rightFrame.hasAttribute('data-original-content')) {
        rightFrame.setAttribute('data-original-content', rightFrame.innerHTML);
    }
    
    // Create and load iframe
    rightFrame.innerHTML = '';
    rightFrame.classList.add('external');
    const iframe = document.createElement('iframe');
    iframe.setAttribute('allow', 'geolocation; fullscreen');
    iframe.src = url;
    rightFrame.appendChild(iframe);

    // Deactivate current section button
    const activeButton = document.querySelector('.section-button.active');
    if (activeButton) {
        activeButton.classList.remove('active');
    }
}

// Update link click event listener
document.addEventListener('click', function(e) {
    if (e.target.tagName === 'A' && !e.target.closest('.section-buttons')) {
        e.preventDefault();
        const inFrame = e.target.hasAttribute('data-frame');
        loadExternalUrl(e.target.href, inFrame);
    }
});

// ***** Initial code *****

// Update location on page load and every minute thereafter
updateLatLong();
setInterval(updateLatLong, locUpdateInterval * 1000);
setInterval(updateLocationData, locDataUpdateInterval * 1000);

// Show the default section
showSection('news');
