// Settings
const LATLON_UPDATE_INTERVAL = 2; // seconds
const UPDATE_DISTANCE_THRESHOLD = 500; // meters
const UPDATE_TIME_THRESHOLD = 10; // minutes
const WX_DISTANCE_THRESHOLD = 25000; // meters
const WX_TIME_THRESHOLD = 30; // minutes
const NEWS_REFRESH_INTERVAL = 2.5; // minutes
const MAX_SPEED = 50; // Maximum speed for radar display (mph)
const TEST_CENTER_LAT = 39.7392; // Denver
const TEST_CENTER_LONG = -104.9903; // Denver
const TEST_CIRCLE_RADIUS = 10; // miles
const TEST_MIN_SPEED = 75; // mph
const TEST_MAX_SPEED = 95; // mph
const TEST_MIN_ALT = 50;
const TEST_MAX_ALT = 250;
const GEONAMES_USERNAME = 'birgefuller';
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
let localManualDarkMode = false; // Transient manual dark mode (when settings are not available)
let darkOn = false;
let newsUpdateInterval = null;
let newsUpdatesActive = false; // Track if news updates should be active
let testModeAngle = 0;
let testModeSpeed = TEST_MIN_SPEED;
let testModeAlt = TEST_MIN_ALT;
let testModeSpeedIncreasing = true;
let testModeAltIncreasing = true;
let radarContext = null;
let gpsIntervalId = null;
let lastGPSUpdate = 0;
let locationTimeZone = browserTimeZone();
let lastNewsTimestamp = 0; // Track the latest news timestamp we've seen
let userHasSeenLatestNews = true; // Track if user has seen the latest news
let seenNewsIds = new Set(); // Track news IDs we've already seen
let settings = {}; // Global settings object to cache user settings

// Custom log function that prepends the current time
function customLog(...args) {
    const now = new Date();
    const timeString = now.toLocaleTimeString();
    console.log(`[${timeString}] `, ...args);
}

// Update element with a change-dependent highlight effect
function highlightUpdate(id, content = null) {
    const element = document.getElementById(id);
    if (content !== null) {
        if (element.innerHTML === content) {
            return; // Exit if content is the same
        }
        element.innerHTML = content;
    }
    const highlightColor = getComputedStyle(document.documentElement).getPropertyValue('--tesla-blue').trim();
    const originalFontWeight = getComputedStyle(element).fontWeight;

    element.style.transition = 'color 0.5s, font-weight 0.5s';
    element.style.color = highlightColor;
    // element.style.fontWeight = '800';

    setTimeout(() => {
        element.style.transition = 'color 2s, font-weight 2s';
        element.style.color = ''; // Reset to default color
        // element.style.fontWeight = ''; // Reset to original font weight
    }, 2000);
}

// Return time zone based on browser settings
function browserTimeZone() {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    customLog('Browser timezone: ', tz);
    return tz;
}

// Helper function to format time according to user settings
function formatTime(date, options = {}) {
    // Default options
    const defaultOptions = {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: locationTimeZone
    };
    
    // Merge provided options with defaults
    const timeOptions = {...defaultOptions, ...options};
    
    // Check if 24-hour format is enabled in settings
    if (currentUser && settings && settings['24hr-time']) {
        timeOptions.hour12 = false;
    }
    
    return date.toLocaleTimeString('en-US', timeOptions);
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

async function updateTimeZone(lat, long) {
    try {
        if (!lat || !long) {
            throw new Error('Location not available.');
        }
        const response = await fetch(`https://secure.geonames.org/timezoneJSON?lat=${lat}&lng=${long}&username=${GEONAMES_USERNAME}`);
        const tzData = await response.json();
        if (!tzData || !tzData.timezoneId) {
            throw new Error('Timezone not returned from server.');
        }
        customLog('Timezone: ', tzData);
        return tzData.timezoneId;
    } catch (error) {
        console.error('Error fetching time zone: ', error);
        customLog('Error fetching time zone: ', error);
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        customLog('Using timezone: ', tz);
        return tz;
    }
}

// Manually set dark/light mode
function toggleMode() {
    if (currentUser) {
        toggleSetting('auto-dark-mode', false);
    } else {
        localManualDarkMode = true;
    }
    document.body.classList.toggle('dark-mode');
    var darkOn = document.body.classList.contains('dark-mode');
    document.getElementById('darkModeToggle').checked = darkOn;
    updateDarkModeDependants();
}

// Update the dark/light mode based on sunrise/sunset
function autoDarkMode() {
    if (currentUser && settings && settings['auto-dark-mode'] !== undefined) {
        manualDarkMode = !settings['auto-dark-mode'];
        customLog('Using auto dark mode user setting: ', manualDarkMode);
    } else {
        manualDarkMode = localManualDarkMode;
    }
    if (!manualDarkMode && lat !== null && long !== null) {
        const now = new Date();
        const currentTime = now.getTime();
        const sunriseTime = new Date(sunrise).getTime();
        const sunsetTime = new Date(sunset).getTime();

        if (currentTime >= sunsetTime || currentTime < sunriseTime) {
            if (!darkOn) {
                customLog('Applying dark mode based on sunset...');
                document.body.classList.add('dark-mode');
                darkOn = true;
                document.getElementById('darkModeToggle').checked = true;
                updateDarkModeDependants();
            }
        } else {
            if (darkOn) {
                customLog('Applying light mode based on sunrise...');
                document.body.classList.remove('dark-mode');
                darkOn = false;
                document.getElementById('darkModeToggle').checked = false;
                updateDarkModeDependants();
            }
        }
    }
}

function updateDarkModeDependants() {
    // Update the network graph axis colors
    updateChartAxisColors();
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
        // Use test parameter when in test mode
        const url = testMode ? 'rss.php?test' : 'rss.php';
        const response = await fetch(url);
        const items = await response.json();
        
        const newsContainer = document.getElementById('newsHeadlines');
        if (!newsContainer) return;

        customLog('Updating news headlines...' + (testMode ? ' (TEST MODE)' : ''));
        
        // Filter for new items only
        let hasNewItems = false;
        const newItems = [];
        
        if (items.length > 0) {
            // Generate unique IDs for each news item 
            items.forEach(item => {
                // Create a unique ID based on title and source
                const itemId = `${item.source}-${item.title.substring(0, 40)}`;
                item.id = itemId;
                
                // Check if this is a new item
                if (!seenNewsIds.has(itemId)) {
                    hasNewItems = true;
                    newItems.push(item);
                    seenNewsIds.add(itemId);
                }
            });
            
            // If we have new items, update notification and add to container
            if (hasNewItems) {
                const newestTimestamp = Math.max(...items.map(item => item.date));
                if (newestTimestamp > lastNewsTimestamp) {
                    lastNewsTimestamp = newestTimestamp;
                    userHasSeenLatestNews = false;
                    
                    // Only add notification dot if news section is not currently displayed
                    const newsSection = document.getElementById('news');
                    if (newsSection && newsSection.style.display !== 'block') {
                        const newsButton = document.querySelector('.section-button[onclick="showSection(\'news\')"]');
                        if (newsButton) {
                            newsButton.classList.add('has-notification');
                        }
                    }
                }
                
                // Create HTML for new items with blue dot indicator
                let newItemsHtml = newItems.map(item => {
                    const date = new Date(item.date * 1000);
                    const dateString = date.toLocaleDateString('en-US', { 
                        month: 'short', 
                        day: 'numeric'
                    });
                    const timeString = formatTime(date, { 
                        timeZoneName: 'short'
                    });
                    
                    // Extract domain for favicon
                    let faviconUrl = '';
                    try {
                        const url = new URL(item.link);
                        if (url.hostname === 'www.boston.com') {
                            faviconUrl = 'https://www.bostonglobe.com/favicon.ico';
                        } else {
                            faviconUrl = `https://${url.hostname}/favicon.ico`;
                        }
                    } catch (e) {
                        console.error("Invalid URL:", item.link);
                        customLog("Invalid URL:", item.link);
                        faviconUrl = 'favicon.ico'; // Default fallback
                    }
                    
                    return `
                        <button class="news-item news-new" data-id="${item.id}" onclick="loadExternalUrl('${item.link}')">
                            <img src="${faviconUrl}" class="news-favicon" onerror="this.style.display='none'">
                            <div>
                                <span class="news-source">${item.source.toUpperCase()}</span>
                                <span class="news-date">${dateString}</span>
                                <span class="news-time">${timeString}</span>
                            </div>
                            <div class="news-title">${item.title}</div>
                        </button>`;
                }).join('');
                
                // Prepend new items to existing content or initialize if empty
                if (newsContainer.innerHTML && !newsContainer.innerHTML.includes('<em>')) {
                    newsContainer.innerHTML = newItemsHtml + newsContainer.innerHTML;
                } else {
                    newsContainer.innerHTML = newItemsHtml || '<p><em>No headlines available</em></p>';
                }
            }
        }
        
        // If there were no new items and the container is empty, show a message
        if (!hasNewItems && (!newsContainer.innerHTML || newsContainer.innerHTML.includes('<em>'))) {
            newsContainer.innerHTML = '<p><em>No new headlines available</em></p>';
        }
        
    } catch (error) {
        console.error('Error fetching news:', error);
        customLog('Error fetching news:', error);
        document.getElementById('newsHeadlines').innerHTML = 
            '<p><em>Error loading headlines</em></p>';
    }
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
    locationTimeZone = await updateTimeZone(lat, long);  // TODO: this should be done more rarely
    fetchCityData(lat, long);

    // Update connectivity data iff the Network section is visible
    const networkSection = document.getElementById("network");
    if (networkSection.style.display === "block") {
        customLog('Updating connectivity data...');
        updateNetworkInfo();
    }

    // Update Wikipedia data iff the Landmarks section is visible
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
    
    // Update GPS status indicator with color gradient based on accuracy
    const gpsStatusElement = document.getElementById('gps-status');
    if (gpsStatusElement) {
        if (lat === null || long === null) {
            // Use CSS variable for unavailable GPS
            gpsStatusElement.style.color = 'var(--status-unavailable)';
            gpsStatusElement.title = 'GPS Unavailable';
        } else {
            // Interpolate between yellow and green based on accuracy
            const maxAccuracy = 50;  // Yellow threshold
            const minAccuracy = 1;   // Green threshold
            
            // Clamp accuracy between min and max thresholds
            const clampedAcc = Math.min(Math.max(acc, minAccuracy), maxAccuracy);
            
            // Calculate interpolation factor (0 = yellow, 1 = green)
            const factor = 1 - (clampedAcc - minAccuracy) / (maxAccuracy - minAccuracy);
            
            if (factor < 0.5) {
                gpsStatusElement.style.color = 'var(--status-poor)';
            } else {
                gpsStatusElement.style.color = 'var(--status-good)';
            }
            
            gpsStatusElement.title = `GPS Accuracy: ${Math.round(acc)}m`;
        }
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

    // Short distance updates
    if (shouldUpdateLocationData()) {
        updateLocationData(lat, long);
    }

    // Long distance updates
    if (shouldUpdateWeatherData()) {
        fetchWeatherData(lat, long);
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

// Function to pause news updates
function pauseNewsUpdates() {
    if (newsUpdateInterval) {
        clearInterval(newsUpdateInterval);
        newsUpdateInterval = null;
        customLog('News updates paused');
    }
}

// Function to resume news updates if they were active
function resumeNewsUpdates() {
    if (newsUpdatesActive && !newsUpdateInterval) {
        updateNews(); // Call immediately
        // Set interval based on test mode
        if (testMode) {
            newsUpdateInterval = setInterval(updateNews, 15000);
        } else {
            newsUpdateInterval = setInterval(updateNews, 60000 * NEWS_REFRESH_INTERVAL);
        }
        customLog('News updates resumed');
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

    // If switching to news section, clear the notification dot
    if (sectionId === 'news') {
        userHasSeenLatestNews = true;
        const newsButton = document.querySelector('.section-button[onclick="showSection(\'news\')"]');
        if (newsButton) {
            newsButton.classList.remove('has-notification');
        }
    }

    // Clear "new" markers from news items when switching to a different section
    if (sectionId !== 'news') {
        const newNewsItems = document.querySelectorAll('.news-new');
        newNewsItems.forEach(item => {
            item.classList.remove('news-new');
        });
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
                // Set newsUpdatesActive to true
                newsUpdatesActive = true;
                // if we're in test mode, set the interval to update every 15 seconds
                if (testMode) {
                    newsUpdateInterval = setInterval(updateNews, 15000);
                } else {
                    newsUpdateInterval = setInterval(updateNews, 60000 * NEWS_REFRESH_INTERVAL);
                }
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
            
            // Reinitialize the ping chart when showing the network section
            if (pingData.length > 0 && pingChart) {
                pingChart.data.labels = Array.from({ length: pingData.length }, (_, i) => i);
                pingChart.update();
            }
        }
        
        if (sectionId === 'landmarks') {
            if (lat !== null && long !== null) {
                fetchWikipediaData(lat, long);
            } else {
                customLog('Location not available to fetch Wikipedia data.');
            }
        }

        if (sectionId === 'about') {
            const versionElement = document.getElementById('version');
            if (versionElement && !versionElement.dataset.loaded) {
                fetch('vers.php')
                    .then(response => response.json())
                    .then(data => {
                        const versionText = `${data.branch || 'unknown'}-${data.commit || 'unknown'}`;
                        versionElement.innerHTML = versionText;
                        versionElement.dataset.loaded = true; // Mark as loaded
                    })
                    .catch(error => {
                        console.error('Error fetching version:', error);
                        versionElement.innerHTML = 'Error loading version';
                    });
            }
        }
    }

    // Activate the clicked button
    const button = document.querySelector(`.section-button[onclick="showSection('${sectionId}')"]`);
    if (button) {
        button.classList.add('active');
    }
}

// ***** Login functionality *****
let isLoggedIn = false;
let currentUser = null;

// Function to show the login modal
function showLoginModal() {
    const modal = document.getElementById('login-modal');
    modal.style.display = 'flex';
    document.getElementById('user-id').focus();
    document.getElementById('login-error').textContent = ''; // Clear previous errors
}

// Function to hide the login modal
function closeLoginModal() {
    document.getElementById('login-modal').style.display = 'none';
}

// Function to validate user ID
function validateUserId(userId) {
    // Check for minimum length (9 characters)
    if (userId.length < 9) {
        return { valid: false, message: 'User ID must be at least 9 characters long.' };
    }
    
    // Check for standard characters (letters, numbers, underscore, hyphen)
    const validFormat = /^[a-zA-Z0-9_-]+$/;
    if (!validFormat.test(userId)) {
        return { valid: false, message: 'User ID can only contain letters, numbers, underscore, and hyphen.' };
    }
    
    return { valid: true };
}

// Function to handle login
async function handleLogin() {
    const userId = document.getElementById('user-id').value.trim();
    const validation = validateUserId(userId);
    
    if (!validation.valid) {
        document.getElementById('login-error').textContent = validation.message;
        return;
    }
    
    // Successful validation
    try {
        // Check if user exists and create if needed
        const response = await fetch(`settings.php?user=${encodeURIComponent(userId)}`, {
            method: 'GET'
        });
        
        if (response.ok) {
            // Login successful
            isLoggedIn = true;
            currentUser = userId;
            
            // Update UI
            closeLoginModal();
            updateLoginState();
            
            // Load settings
            loadUserSettings();
            
            // Activate the settings section button
            document.getElementById('settings-section').classList.remove('hidden');
            
            // Update URL with userid parameter
            updateUrlWithUserId(userId);
            
            // Save user ID in a cookie
            setCookie('userid', userId);
        } else {
            document.getElementById('login-error').textContent = 'Error authenticating. Please try again.';
        }
    } catch (error) {
        console.error('Login error:', error);
        document.getElementById('login-error').textContent = 'Network error. Please try again.';
    }
}

// Function to handle logout
function handleLogout() {
    isLoggedIn = false;
    currentUser = null;
    
    // Update UI
    updateLoginState();
    
    // Hide settings section
    document.getElementById('settings-section').classList.add('hidden');
    
    // If currently in settings section, redirect to news
    const sections = document.querySelectorAll('.section');
    const settingsSection = document.getElementById('settings');
    if (settingsSection.style.display === 'block') {
        showSection('news');
    }
    
    // Remove userid from URL
    removeUserIdFromUrl();
    
    // Remove the userid cookie
    deleteCookie('userid');
}

// Function to update URL with userId
function updateUrlWithUserId(userId) {
    const url = new URL(window.location);
    url.searchParams.set('userid', userId);
    window.history.pushState({}, '', url);
}

// Function to remove userId from URL
function removeUserIdFromUrl() {
    const url = new URL(window.location);
    url.searchParams.delete('userid');
    window.history.pushState({}, '', url);
}

// Function to attempt login from URL parameter or cookie
async function attemptLogin() {
    const urlParams = new URLSearchParams(window.location.search);
    let userId = urlParams.get('userid');
    
    // If no userid in URL, try to get from cookie
    if (!userId) {
        userId = getCookie('userid');
        console.log('Checking for userid cookie:', userId ? 'found' : 'not found');
    }
    
    if (userId) {
        const validation = validateUserId(userId);
        if (validation.valid) {
            try {
                // Check if user exists and create if needed
                const response = await fetch(`settings.php?user=${encodeURIComponent(userId)}`, {
                    method: 'GET'
                });
                
                if (response.ok) {
                    // Login successful
                    isLoggedIn = true;
                    currentUser = userId;
                    
                    // Update UI
                    updateLoginState();
                    
                    // Load settings
                    await loadUserSettings();
                    
                    // Activate the settings section button
                    document.getElementById('settings-section').classList.remove('hidden');
                    
                    customLog('Successfully logged in via ' + (urlParams.get('userid') ? 'URL parameter' : 'cookie'));
                    
                    // If login was from cookie, also update the URL
                    if (!urlParams.get('userid')) {
                        updateUrlWithUserId(userId);
                    }
                } else {
                    console.error('Error authenticating with user ID');
                }
            } catch (error) {
                console.error('Login error:', error);
            }
        } else {
            console.error('Invalid user ID:', validation.message);
        }
    }
}

// Function to update login/logout button based on state
function updateLoginState() {
    const loginButton = document.getElementById('login-button');
    
    if (isLoggedIn) {
        loginButton.textContent = 'Logout';
        loginButton.onclick = handleLogout;
        
        // Update settings section header
        document.getElementById('settings-header').textContent = `Settings for ${currentUser}`;
    } else {
        loginButton.textContent = 'Login';
        loginButton.onclick = showLoginModal;
    }
}

// Function to load user settings
async function loadUserSettings() {
    if (!isLoggedIn || !currentUser) return;
    
    try {
        const response = await fetch(`settings.php?user=${encodeURIComponent(currentUser)}`, {
            method: 'GET'
        });
        
        if (response.ok) {
            // Load settings directly from server
            // The server now returns booleans directly
            settings = await response.json();
            customLog('Settings loaded:', settings);
            
            // Initialize toggle states based on saved settings
            initializeToggleStates();
        } else {
            console.error('Error loading settings');
        }
    } catch (error) {
        console.error('Settings loading error:', error);
    }
}

// Function called by the toggle UI elements
function toggleSettingFromElement(element) {
    const settingItem = element.closest('.settings-toggle-item');
    if (settingItem && settingItem.dataset.setting) {
        const key = settingItem.dataset.setting;
        const value = element.checked;
        toggleSetting(key, value);
    }
}

// Function to toggle a setting (updates both local cache and server)
async function toggleSetting(key, value) {
    if (!isLoggedIn || !currentUser) return;
    
    try {
        // Update the local settings cache with boolean value
        settings[key] = value;
        
        // Update toggle state visually
        updateToggleVisualState(key, value);
        
        // Update the server with the boolean value directly
        const response = await fetch('settings.php', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                user: currentUser,
                key: key,
                value: value
            })
        });
        
        if (response.ok) {
            customLog(`Setting "${key}" updated to ${value}`);
        } else {
            customLog(`Failed to update setting "${key}" on server`);
        }
    } catch (error) {
        customLog('Error toggling setting:', error);
    }
}

// Update visual state of a toggle
function updateToggleVisualState(key, value) {
    const settingItem = document.querySelector(`.settings-toggle-item[data-setting="${key}"]`);
    if (settingItem) {
        const toggle = settingItem.querySelector('input[type="checkbox"]');
        if (toggle) {
            toggle.checked = value;
        }
    }
}

// Initialize all toggle states based on settings
function initializeToggleStates() {
    // Find all settings toggle items with data-setting attributes
    const toggleItems = document.querySelectorAll('.settings-toggle-item[data-setting]');
    
    toggleItems.forEach(item => {
        const key = item.dataset.setting;
        if (!key) return;
        
        const value = settings[key] !== undefined ? settings[key] : false; // Default to false if not set
        const toggle = item.querySelector('input[type="checkbox"]');
        
        if (toggle) {
            toggle.checked = value;
            customLog(`Initialized toggle for ${key}: ${value}`);
        }
    });
}

// Cookie management functions
function setCookie(name, value, days = 36500) { // Default to ~100 years (forever)
    const d = new Date();
    d.setTime(d.getTime() + (days * 24 * 60 * 60 * 1000));
    const expires = "expires=" + d.toUTCString();
    document.cookie = name + "=" + value + ";" + expires + ";path=/";
    customLog(`Cookie set: ${name}=${value}, expires: ${d.toUTCString()}`);
}

function getCookie(name) {
    const cookieName = name + "=";
    const decodedCookie = decodeURIComponent(document.cookie);
    const cookieArray = decodedCookie.split(';');
    
    console.log(`All cookies: ${document.cookie}`);
    
    for (let i = 0; i < cookieArray.length; i++) {
        let cookie = cookieArray[i];
        while (cookie.charAt(0) === ' ') {
            cookie = cookie.substring(1);
        }
        if (cookie.indexOf(cookieName) === 0) {
            const value = cookie.substring(cookieName.length, cookie.length);
            console.log(`Cookie found: ${name}=${value}`);
            return value;
        }
    }
    console.log(`Cookie not found: ${name}`);
    return "";
}

function deleteCookie(name) {
    document.cookie = name + "=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
    console.log(`Cookie deleted: ${name}`);
}

// ***** Main code *****

// Check for parameters in URL
const urlParams = new URLSearchParams(window.location.search);
testMode = urlParams.has('test');
const initialSection = urlParams.get('section') || 'news';

// Event listeners and initialization after DOM content is loaded
document.addEventListener('DOMContentLoaded', async function () {
    // Attempt login from URL parameter or cookie
    await attemptLogin();

    // Initialize the login/logout button
    updateLoginState();

    // Initialize radar display
    initializeRadar();

    // Start location services
    startGPSUpdates();

    // Handle page visibility changes
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            stopGPSUpdates();
            pauseNewsUpdates();
            stopPingTest();
        } else {
            startGPSUpdates();
            resumeNewsUpdates();
            resumePingTest();
        }
    });

    // Add event listeners for login modal
    document.getElementById('login-cancel').addEventListener('click', closeLoginModal);
    document.getElementById('login-submit').addEventListener('click', handleLogin);

    // Handle Enter key in login form
    document.getElementById('user-id').addEventListener('keyup', function (event) {
        if (event.key === 'Enter') {
            handleLogin();
        }
    });

    // Show the initial section from URL parameter
    showSection(initialSection);
});

// Update link click event listener
document.addEventListener('click', function(e) {
    if (e.target.tagName === 'A' && !e.target.closest('.section-buttons')) {
        e.preventDefault();
        const inFrame = e.target.hasAttribute('data-frame');
        loadExternalUrl(e.target.href, inFrame);
    }
});

// Handle browser back/forward buttons
window.addEventListener('popstate', () => {
    showSection(getInitialSection());
});
