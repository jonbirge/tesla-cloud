// Settings
const LATLON_UPDATE_INTERVAL = 2; // seconds
const UPDATE_DISTANCE_THRESHOLD = 1000; // meters
const UPDATE_TIME_THRESHOLD = 15; // minutes
const WX_DISTANCE_THRESHOLD = 5000; // meters
const WX_TIME_THRESHOLD = 30; // minutes
const NEWS_REFRESH_INTERVAL = 5; // minutes
const MAX_BUFFER_SIZE = 5;
const GEONAMES_USERNAME = 'birgefuller';
const MAX_SPEED = 50; // Maximum speed for radar display (mph)
const TEST_CENTER_LAT = 39.7392; // Denver
const TEST_CENTER_LONG = -104.9903; // Denver
const TEST_CIRCLE_RADIUS = 10; // miles
const TEST_MIN_SPEED = 75; // mph
const TEST_MAX_SPEED = 95; // mph
const TEST_MIN_ALT = 50;
const TEST_MAX_ALT = 250;
const OPENWX_API_KEY = '6a1b1bcb03b5718a9b3a2b108ce3293d';
const MIN_GPS_UPDATE_INTERVAL = 1000; // ms - minimum time between updates
const SAT_URLS = {
    latest: 'https://cdn.star.nesdis.noaa.gov/GOES16/GLM/CONUS/EXTENT3/1250x750.jpg',
    loop: 'https://cdn.star.nesdis.noaa.gov/GOES16/GLM/CONUS/EXTENT3/GOES16-CONUS-EXTENT3-625x375.gif',
    latest_ir: 'https://cdn.star.nesdis.noaa.gov/GOES16/ABI/CONUS/11/1250x750.jpg',
};

// Global variables
let testMode = false; // Set to true if test parameter exists
let lastUpdate = 0; // Timestamp of last location update
let lastUpdateLat = null;
let lastUpdateLong = null;
let lastKnownHeading = null;
let neverUpdatedLocation = true;
let lat = null;
let long = null;
let pingChart = null;
let pingInterval = null;
let pingData = [];
let manualDarkMode = false;
let darkOn = false;
let locationTimeZone = null;
let newsUpdateInterval = null;
let testModeAngle = 0;
let testModeSpeed = TEST_MIN_SPEED;
let testModeAlt = TEST_MIN_ALT;
let testModeSpeedIncreasing = true;
let testModeAltIncreasing = true;
let radarContext = null;
let gpsIntervalId = null;
let lastGPSUpdate = 0;

// Custom log function that prepends the current time
function customLog(...args) {
    const now = new Date();
    const timeString = now.toLocaleTimeString();
    console.log(`[${timeString}] `, ...args);
}

function toggleMode() {
    manualDarkMode = true;
    document.body.classList.toggle('dark-mode');
    darkOn = document.body.classList.contains('dark-mode');
    document.getElementById('darkModeToggle').checked = darkOn;
    
    // Update favicon appearance when dark mode changes
    updateFaviconDarkMode();
}

function highlightUpdate(id, content = null) {
    const element = document.getElementById(id);
    if (content !== null) {
        if (element.innerHTML === content) {
            return; // Exit if content is the same
        }
        element.innerHTML = content;
    }
    const highlightColor =
        document.body.classList.contains('dark-mode') ? 'orange' : 'red';
    element.style.color = highlightColor;
    setTimeout(() => {
        element.style.transition = 'color 2s';
        element.style.color = ''; // Reset to default color
    }, 2000);
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2 - lat1) * Math.PI/180;
    const Δλ = (lon2 - lon1) * Math.PI/180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c; // returns distance in meters
}

function fetchCityData(lat, long) {
    if (!lat || !long) {
        customLog('Location not available for city data.');
        return;
    }

    fetch(`https://secure.geonames.org/findNearbyPlaceNameJSON?lat=${lat}&lng=${long}&username=${GEONAMES_USERNAME}`)
        .then(response => response.json())
        .then(cityData => {
            const place = cityData.geonames && cityData.geonames[0];
            highlightUpdate('city', place ? (place.name || 'N/A') : 'N/A'); // Highlight the city update
            highlightUpdate('state', place ? (place.adminName1 || 'N/A') : 'N/A'); // Highlight the state update
        })
        .catch(error => {
            console.error('Error fetching city data:', error);
        });
}

async function fetchTimeZone(lat, long) {
    try {
        if (!lat || !long) {
            throw new Error('Location not available.');
        }
        const response = await fetch(`https://secure.geonames.org/timezoneJSON?lat=${lat}&lng=${long}&username=${GEONAMES_USERNAME}`);
        const tzData = await response.json();
        if (!tzData || !tzData.timezoneId) {
            throw new Error('Timezone not returned from server.');
        }
        return tzData.timezoneId;
    } catch (error) {
        console.error('Error fetching time zone: ', error);
        customLog('Error fetching time zone: ', error);
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        customLog('Using timezone: ', tz);
        return tz;
    }
}

function updateAutoDarkMode() {
    if (!manualDarkMode && lat !== null && long !== null) {
        const now = new Date();
        const currentTime = now.getTime();
        const sunriseTime = new Date(sunrise).getTime();
        const sunsetTime = new Date(sunset).getTime();

        if (currentTime >= sunsetTime || currentTime < sunriseTime) {
            customLog('Applying dark mode based on sunset...');
            document.body.classList.add('dark-mode');
            darkOn = true;
            document.getElementById('darkModeToggle').checked = true;
        } else {
            customLog('Applying light mode based on sunrise...');
            document.body.classList.remove('dark-mode');
            darkOn = false;
            document.getElementById('darkModeToggle').checked = false;
        }
    } else {
        customLog('Location not available for auto dark mode.');
    }
}

async function fetchWikipediaData(lat, long) {
    if (!lat || !long) {
        customLog('Location not available for Wikipedia data.');
        return;
    }

    customLog('Fetching Wikipedia data...');
    const url = `https://secure.geonames.org/findNearbyWikipediaJSON?lat=${lat}&lng=${long}&username=birgefuller`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        const wikiDiv = document.getElementById('wikipediaInfo');
        if (data.geonames && data.geonames.length > 0) {
            let html = '<ul>';
            data.geonames.forEach(article => {
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
        customLog('Error fetching Wikipedia data:', error);
        document.getElementById('wikipediaInfo').innerHTML = '<p><em>Error loading Wikipedia data.</em></p>';
    }
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

async function updateNews() {
    try {
        const response = await fetch('rss.php');
        const items = await response.json();
        
        const newsContainer = document.getElementById('newsHeadlines');
        if (!newsContainer) return;

        customLog('Updating news headlines...');

        const html = items.map(item => {
            const date = new Date(item.date * 1000);
            const dateString = date.toLocaleDateString('en-US', { 
                month: 'short', 
                day: 'numeric'
            });
            const timeString = date.toLocaleTimeString('en-US', { 
                hour: 'numeric', 
                minute: '2-digit',
                timeZoneName: 'short'
            });
            
            // Extract domain for favicon
            let faviconUrl = '';
            try {
                const url = new URL(item.link);
                faviconUrl = `https://${url.hostname}/favicon.ico`;
            } catch (e) {
                console.error("Invalid URL:", item.link);
                customLog("Invalid URL:", item.link);
                faviconUrl = 'favicon.ico'; // Default fallback
            }
            
            // Apply grayscale filter to favicons
            const darkModeClass = document.body.classList.contains('dark-mode') ? 'dark-mode-favicon' : '';
            
            return `
                <button class="news-item" onclick="loadExternalUrl('${item.link}')">
                    <img src="${faviconUrl}" class="news-favicon ${darkModeClass}" onerror="this.style.display='none'">
                    <div>
                        <span class="news-source">${item.source.toUpperCase()}</span>
                        <span class="news-date">${dateString}</span>
                        <span class="news-time">${timeString}</span>
                    </div>
                    <div class="news-title">${item.title}</div>
                </button>`;
        }).join('');

        newsContainer.innerHTML = html || '<p><em>No headlines available</em></p>';
        
        // Apply dark mode class to favicons if needed
        updateFaviconDarkMode();
    } catch (error) {
        console.error('Error fetching news:', error);
        customLog('Error fetching news:', error);
        document.getElementById('newsHeadlines').innerHTML = 
            '<p><em>Error loading headlines</em></p>';
    }
}

// Function to update favicon dark mode status
function updateFaviconDarkMode() {
    const favicons = document.querySelectorAll('.news-favicon');
    favicons.forEach(favicon => {
        favicon.classList.toggle('dark-mode-favicon', document.body.classList.contains('dark-mode'));
    });
}

function initializeRadar() {
    const canvas = document.getElementById('radarDisplay');
    if (canvas) {
        radarContext = canvas.getContext('2d');
        // Initial draw
        updateWindage(0, null, 0, 0);
    }
}

function updateWindage(vehicleSpeed, vehicleHeading, windSpeed, windDirection) {
    const canvas = radarContext.canvas;
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = Math.min(centerX, centerY) - 8;
    
    // Clear canvas with transparent background
    radarContext.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw circular background
    radarContext.beginPath();
    radarContext.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    radarContext.strokeStyle = '#666';
    radarContext.lineWidth = 1;
    radarContext.stroke();
    
    // Draw concentric circles with speed labels
    for (let i = 1; i <= 4; i++) {
        const currentRadius = (radius * i) / 4;
        radarContext.beginPath();
        radarContext.arc(centerX, centerY, currentRadius, 0, 2*Math.PI);
        radarContext.strokeStyle = '#666';
        radarContext.setLineDash([2, 2]);
        radarContext.stroke();
        radarContext.setLineDash([]);
        
        // Add speed label
        const speedLabel = Math.round((MAX_SPEED * i) / 4);
        radarContext.fillStyle = '#666';
        radarContext.font = '10px Inter';
        radarContext.textAlign = 'right';
        radarContext.fillText(speedLabel, centerX - 5, centerY - currentRadius + 12);
    }
    
    // Draw cardinal direction lines
    radarContext.beginPath();
    radarContext.moveTo(centerX, centerY - radius);
    radarContext.lineTo(centerX, centerY + radius);
    radarContext.moveTo(centerX - radius, centerY);
    radarContext.lineTo(centerX + radius, centerY);
    radarContext.strokeStyle = '#666';
    radarContext.stroke();
    
    // Draw direction labels with dark gray background for visibility
    radarContext.fillStyle = '#666';
    radarContext.font = '12px Inter';
    radarContext.textAlign = 'center';
    radarContext.textBaseline = 'middle';
    
    // Position labels with proper spacing and background
    const labelOffset = radius - 5;
    function drawLabel(text, x, y) {
        const padding = 4;
        const metrics = radarContext.measureText(text);
        radarContext.fillStyle = '#666';
        radarContext.fillText(text, x, y);
    }
    
    drawLabel('FWD', centerX, centerY - labelOffset);
    drawLabel('AFT', centerX, centerY + labelOffset);
    drawLabel('RT', centerX + labelOffset, centerY);
    drawLabel('LT', centerX - labelOffset, centerY);
    
    // Get the Tesla blue color from CSS
    const teslaBlue = getComputedStyle(document.documentElement).getPropertyValue('--tesla-blue').trim();
    
    // Helper function to draw arrow
    function drawArrow(fromX, fromY, toX, toY, color, headLength = 9) {
        const angle = Math.atan2(toY - fromY, toX - fromX);
        const headAngle = Math.PI / 6; // 30 degrees
        
        radarContext.beginPath();
        radarContext.moveTo(fromX, fromY);
        radarContext.lineTo(toX, toY);
        
        // Draw the arrow head
        radarContext.lineTo(
            toX - headLength * Math.cos(angle - headAngle),
            toY - headLength * Math.sin(angle - headAngle)
        );
        radarContext.moveTo(toX, toY);
        radarContext.lineTo(
            toX - headLength * Math.cos(angle + headAngle),
            toY - headLength * Math.sin(angle + headAngle)
        );
        
        radarContext.strokeStyle = color;
        radarContext.lineWidth = 3;
        radarContext.stroke();
    }
    
    // Calculate headwind and crosswind components and display on radar
    let headWind = null;
    let crossWind = null;
    if (vehicleHeading && windDirection) {  // Threshold for meaningful motion    
        const windAngle = windDirection - vehicleHeading; // car frame
        const windAngleRad = (90 - windAngle) * Math.PI / 180;

        // Wind vector components in global frame
        const windX = windSpeed * Math.cos(windAngleRad);
        const windY = windSpeed * Math.sin(windAngleRad);
    
        // Sum the vectors to get relative wind (for radar plot)
        const relativeWindX = windX;
        const relativeWindY = windY;
    
        headWind = -windY;  // Will be negative if a tailwind
        crossWind = windX;  // Will be positive if from the left

        const windScale = radius / MAX_SPEED;
        const relativeWindXPlot = centerX + relativeWindX * windScale;
        const relativeWindYPlot = centerY - relativeWindY * windScale;
        drawArrow(centerX, centerY, relativeWindXPlot, relativeWindYPlot, teslaBlue);
    }

    // Update the wind component displays
    if (headWind !== null) {
        document.getElementById('headwind').innerText = Math.abs(Math.round(headWind));
        document.getElementById('headwind-arrow').innerHTML = (headWind > 0 ? '&#9660;' : '&#9650;'); // down/up filled triangles
        // Change the label to TAILWIND when headWind is negative
        document.getElementById('headwind-label').innerText = (headWind < 0) ? "TAILWIND (MPH)" : "HEADWIND (MPH)";
    } else {
        document.getElementById('headwind').innerText = '--';
        document.getElementById('headwind-arrow').innerHTML = '';
        document.getElementById('headwind-label').innerText = "HEADWIND (MPH)";
    }
    if (crossWind !== null) {
        document.getElementById('crosswind').innerText = Math.abs(Math.round(crossWind));
        document.getElementById('crosswind-arrow').innerHTML = (crossWind >= 0 ? '&#9654;' : '&#9664;'); // right/left triangles
    } else {
        document.getElementById('crosswind').innerText = '--';
        document.getElementById('crosswind-arrow').innerHTML = '';
    }
}

async function updateLocationData(lat, long) {
    if (!lat || !long) {
        customLog('Location not available for location data.');
        return;
    }

    customLog('Updating location dependent data for (', lat, ', ', long, ')');
    neverUpdatedLocation = false;

    // Fire off API requests for external data
    locationTimeZone = await fetchTimeZone(lat, long);
    customLog('Timezone: ', locationTimeZone);
    fetchCityData(lat, long);
    fetchSunData(lat, long);

    // Update connectivity data if the Network section is visible
    const networkSection = document.getElementById("network");
    if (networkSection.style.display === "block") {
        customLog('Updating connectivity data...');
        updateNetworkInfo();
    }

    // Update Wikipedia data if the Landmarks section is visible
    const locationSection = document.getElementById("landmarks");
    if (locationSection.style.display === "block") {
        customLog('Updating Wikipedia data...');
        fetchWikipediaData(lat, long);
    }

    lastUpdateLat = lat;
    lastUpdateLong = long;
    lastUpdate = Date.now();
}

function getTestModePosition() {
    // Calculate new position based on angle
    const radiusInDegrees = TEST_CIRCLE_RADIUS / 69; // Rough conversion from miles to degrees
    const testLat = TEST_CENTER_LAT + radiusInDegrees * Math.cos(testModeAngle);
    const testLong = TEST_CENTER_LONG + radiusInDegrees * Math.sin(testModeAngle);
    
    // Update angle for next time (move about 1 degree per second at 40mph)
    const angleIncrement = (testModeSpeed / (2 * Math.PI * TEST_CIRCLE_RADIUS)) * (2 * Math.PI) / (60 * 60);
    testModeAngle = (testModeAngle + angleIncrement) % (2 * Math.PI);
    
    // Update speed (oscillate between min and max)
    if (testModeSpeedIncreasing) {
        testModeSpeed += 0.1;
        if (testModeSpeed >= TEST_MAX_SPEED) {
            testModeSpeedIncreasing = false;
        }
    } else {
        testModeSpeed -= 0.1;
        if (testModeSpeed <= TEST_MIN_SPEED) {
            testModeSpeedIncreasing = true;
        }
    }
    
    // Update altitude (oscillate between min and max)
    if (testModeAltIncreasing) {
        testModeAlt += 0.5;
        if (testModeAlt >= TEST_MAX_ALT) {
            testModeAltIncreasing = false;
        }
    } else {
        testModeAlt -= 0.5;
        if (testModeAlt <= TEST_MIN_ALT) {
            testModeAltIncreasing = true;
        }
    }

    // Calculate heading based on movement around the circle
    const heading = (((testModeAngle * 180 / Math.PI) + 90) % 360);

    return {
        coords: {
            latitude: testLat,
            longitude: testLong,
            altitude: testModeAlt * 0.3048, // Convert feet to meters
            speed: testModeSpeed * 0.44704, // Convert mph to m/s
            heading: heading,
            accuracy: 5, // Simulate a good GPS signal with 5m accuracy
        },
        timestamp: Date.now(),
    };
}

function shouldUpdateLocationData() {
    if (neverUpdatedLocation || !lastUpdateLat || !lastUpdateLong) {
        return true;
    }

    const now = Date.now();
    const timeSinceLastUpdate = (now - lastUpdate) / (1000 * 60); // Convert to minutes
    const distance = calculateDistance(lat, long, lastUpdateLat, lastUpdateLong);
    
    return distance >= UPDATE_DISTANCE_THRESHOLD || timeSinceLastUpdate >= UPDATE_TIME_THRESHOLD;
}

function handlePositionUpdate(position) {
    lat = position.coords.latitude;
    long = position.coords.longitude;
    alt = position.coords.altitude;
    acc = position.coords.accuracy;
    speed = position.coords.speed / 0.44704; // Convert m/s to mph
    if (position.coords.heading) {
        lastKnownHeading = position.coords.heading;
    }
    
    // Update radar display with current speed and heading if nav section is visible
    const navigationSection = document.getElementById("navigation");
    if (navigationSection.style.display === "block") {
        // Update heading displays
        if (lastKnownHeading) {
            document.getElementById('heading').innerText = Math.round(lastKnownHeading) + '°';
            if (weatherData) {
                const windSpeedMPH = Math.min((weatherData.windSpeed * 2.237), MAX_SPEED);
                const windDir = weatherData.windDirection;
                updateWindage(speed, lastKnownHeading, windSpeedMPH, windDir);
            } else {
                updateWindage(speed, lastKnownHeading, 0, 0);
            }
        } else {
            document.getElementById('heading').innerText = '--';
            updateWindage(0, null, 0, 0);
        }

        // Update display values
        document.getElementById('altitude').innerText = alt ? Math.round(alt * 3.28084) : '--'; // Convert meters to feet
        document.getElementById('accuracy').innerText = acc ? Math.round(acc) + ' m' : '--';
    }

    // Check if we should update location-dependent API data
    if (shouldUpdateLocationData()) {
        updateLocationData(lat, long);
    }

    // Check if we should update the expensive weather API data
    const weatherSection = document.getElementById("weather");
    if (weatherSection.style.display === "block" || navigationSection.style.display === "block") {
        if (shouldUpdateWeatherData()) {
            fetchWeatherData(lat, long);
        }
    }
}

function updateGPS() {
    if (!testMode) {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(handlePositionUpdate);
        } else {
            customLog('Geolocation is not supported by this browser.');
        }
    } else { // testing
        handlePositionUpdate(getTestModePosition());
    }
}

// Modified updateGPS wrapper with throttling
function throttledUpdateGPS() {
    const now = Date.now();
    if (now - lastGPSUpdate >= MIN_GPS_UPDATE_INTERVAL) {
        lastGPSUpdate = now;
        updateGPS();
    } else {
        customLog('Skipping rapid GPS update');
    }
}

// Function to start the GPS updates
function startGPSUpdates() {
    if (!gpsIntervalId) {
        updateGPS(); // Call immediately
        gpsIntervalId = setInterval(throttledUpdateGPS, 1000*LATLON_UPDATE_INTERVAL);
        customLog('GPS updates started');
    }
}

// Function to stop the GPS updates
function stopGPSUpdates() {
    if (gpsIntervalId) {
        clearInterval(gpsIntervalId);
        gpsIntervalId = null;
        customLog('GPS updates paused');
    }
}

// Show a specific section and update URL
function showSection(sectionId) {
    // Log the clicked section
    customLog(`Showing section: ${sectionId}`);

    // Update URL without page reload 
    const url = new URL(window.location);
    url.searchParams.set('section', sectionId);
    window.history.pushState({}, '', url);

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

        // Original section-specific logic
        if (sectionId === 'news') {
            // Only update news if interval is not set (first visit)
            if (!newsUpdateInterval) {
                updateNews();
                newsUpdateInterval = setInterval(updateNews, 60000 * NEWS_REFRESH_INTERVAL);
            }
        }
        
        // Load expensive weather data if not already done
        if (sectionId === 'weather' || sectionId === 'navigation') {
            // Load latest weather data
            if (lat !== null && long !== null) {
                if (!forecastData || !weatherData) {
                    fetchWeatherData(lat, long);
                }
            } else {
                customLog('Location not available to fetch weather data.');
            }
        }

        if (sectionId === 'satellite') {
            // Load weather image when satellite section is shown
            const weatherImage = document.getElementById('weather-image');
            weatherImage.src = SAT_URLS.latest;
        } else {
            // Remove weather img src to force reload when switching back
            const weatherImage = document.getElementById('weather-image');
            if (weatherImage) {
                weatherImage.src = '';
            }
        }

        if (sectionId === 'network') {
            updateNetworkInfo();
        }
        
        if (sectionId === 'landmarks') {
            if (lat !== null && long !== null) {
                fetchWikipediaData(lat, long);
            } else {
                customLog('Location not available to fetch Wikipedia data.');
            }
        }
    }

    // Activate the clicked button
    const button = document.querySelector(`.section-button[onclick="showSection('${sectionId}')"]`);
    if (button) {
        button.classList.add('active');
    }
}

// ***** Main code *****

// Check for parameters in URL
const urlParams = new URLSearchParams(window.location.search);
testMode = urlParams.has('test');
const initialSection = urlParams.get('section') || 'news';

// Update link click event listener
document.addEventListener('click', function(e) {
    if (e.target.tagName === 'A' && !e.target.closest('.section-buttons')) {
        e.preventDefault();
        const inFrame = e.target.hasAttribute('data-frame');
        loadExternalUrl(e.target.href, inFrame);
    }
});

// Handle page visibility changes
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        stopGPSUpdates();
    } else {
        startGPSUpdates();
    }
});

// Add click handler to close popup when clicking overlay
document.querySelector('.overlay').addEventListener('click', closeHourlyForecast);

// Handle browser back/forward buttons
window.addEventListener('popstate', () => {
    showSection(getInitialSection());
});

// Initialize radar display
initializeRadar();

// Show the initial section from URL parameter
showSection(initialSection);

// Replace the direct GPS update calls at the end of your script with:
startGPSUpdates();
