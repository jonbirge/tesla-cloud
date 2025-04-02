// Settings
const LATLON_UPDATE_INTERVAL = 2; // seconds
const UPDATE_DISTANCE_THRESHOLD = 500; // meters
const UPDATE_TIME_THRESHOLD = 10; // minutes
const WX_DISTANCE_THRESHOLD = 25000; // meters
const WX_TIME_THRESHOLD = 30; // minutes
const MAX_SPEED = 50; // Maximum speed for radar display (mph)
const MIN_GPS_UPDATE_INTERVAL = 1000; // ms - minimum time between updates
const SAT_URLS = {
    latest: 'https://cdn.star.nesdis.noaa.gov/GOES16/GLM/CONUS/EXTENT3/1250x750.jpg',
    loop: 'https://cdn.star.nesdis.noaa.gov/GOES16/GLM/CONUS/EXTENT3/GOES16-CONUS-EXTENT3-625x375.gif',
    latest_ir: 'https://cdn.star.nesdis.noaa.gov/GOES16/ABI/CONUS/11/1250x750.jpg',
};

// Imports
import { customLog, highlightUpdate, testMode, updateTimeZone, GEONAMES_USERNAME } from './common.js';
import { PositionSimulator } from './location.js';
import { attemptLogin, settings } from './settings.js';
import { fetchWeatherData, weatherData } from './wx.js';
import { updateNetworkInfo, startPingTest } from './net.js';
import { setUserHasSeenLatestNews } from './news.js';

// Variables
let lastUpdate = 0; // Timestamp of last location update
let lat = null;
let long = null;
let alt = null;
let acc = null;
let speed = null;
let lastUpdateLat = null;
let lastUpdateLong = null;
let lastKnownHeading = null;
let lastWxUpdate = 0;
let lastWxUpdateLat = null;
let lastWxUpdateLong = null;
let neverUpdatedLocation = true;
let radarContext = null;
let gpsIntervalId = null;
let lastGPSUpdate = 0;
let networkInfoUpdated = false; // Track if network info has been updated
const positionSimulator = new PositionSimulator(); // TODO: only create if needed

// Function to calculate the distance between two coordinates
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // returns distance in meters
}

// Function to fetch city data based on latitude and longitude
function fetchCityData(lat, long) {
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

// Function to fetch nearby Wikipedia data based on coordinates
async function fetchLandmarkData(lat, long) {
    customLog('Fetching Wikipedia data...');
    const url = `https://secure.geonames.org/findNearbyWikipediaJSON?lat=${lat}&lng=${long}&username=${GEONAMES_USERNAME}`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        const landmarkDiv = document.getElementById('landmark-items');
        if (data.geonames && data.geonames.length > 0) {
            let html = '<ul>';
            data.geonames.forEach(article => {
                const pageUrl = article.wikipediaUrl.startsWith('http') ? article.wikipediaUrl : 'http://' + article.wikipediaUrl;
                html += `<li><a href="${pageUrl}" target="_blank">${article.title}</a>: ${article.summary}</li>`;
            });
            html += '</ul>';
            landmarkDiv.innerHTML = html;
        } else {
            landmarkDiv.innerHTML = '<p><em>No nearby landmarks found.</em></p>';
        }
    } catch (error) {
        console.error('Error fetching Wikipedia data:', error);
        document.getElementById('landmark-items').innerHTML = '<p><em>Error loading landmark data.</em></p>';
    }
}

// Function to initialize the radar display
function initializeRadar() {
    const canvas = document.getElementById('radarDisplay');
    if (canvas) {
        radarContext = canvas.getContext('2d');
        // Initial draw
        updateWindage(0, null, 0, 0);
    }
}

// Function to update windage on the radar display
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
        radarContext.arc(centerX, centerY, currentRadius, 0, 2 * Math.PI);
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

    // Update the wind component displays with proper units
    if (headWind !== null) {
        if (!settings || settings["imperial-units"]) {
            document.getElementById('headwind').innerText = Math.abs(Math.round(headWind));
        } else {
            // Convert mph to m/s (1 mph ≈ 0.44704 m/s)
            document.getElementById('headwind').innerText = Math.abs(Math.round(headWind * 0.44704));
        }
        document.getElementById('headwind-arrow').innerHTML = (headWind > 0 ? '&#9660;' : '&#9650;'); // down/up filled triangles
        // Change the label to TAILWIND when headWind is negative and use appropriate units
        if (!settings || settings["imperial-units"]) {
            document.getElementById('headwind-label').innerText = (headWind < 0) ? "TAILWIND (MPH)" : "HEADWIND (MPH)";
        } else {
            document.getElementById('headwind-label').innerText = (headWind < 0) ? "TAILWIND (M/S)" : "HEADWIND (M/S)";
        }
    } else {
        document.getElementById('headwind').innerText = '--';
        document.getElementById('headwind-arrow').innerHTML = '';
        // Set label with appropriate units
        if (!settings || settings["imperial-units"]) {
            document.getElementById('headwind-label').innerText = "HEADWIND (MPH)";
        } else {
            document.getElementById('headwind-label').innerText = "HEADWIND (M/S)";
        }
    }

    if (crossWind !== null) {
        if (!settings || settings["imperial-units"]) {
            document.getElementById('crosswind').innerText = Math.abs(Math.round(crossWind));
        } else {
            // Convert mph to m/s
            document.getElementById('crosswind').innerText = Math.abs(Math.round(crossWind * 0.44704));
        }
        document.getElementById('crosswind-arrow').innerHTML = (crossWind >= 0 ? '&#9654;' : '&#9664;'); // right/left triangles
    } else {
        document.getElementById('crosswind').innerText = '--';
        document.getElementById('crosswind-arrow').innerHTML = '';
    }
    // Set label with appropriate units
    if (!settings || settings["imperial-units"]) {
        document.getElementById('crosswind-label').innerText = "CROSSWIND (MPH)";
    } else {
        document.getElementById('crosswind-label').innerText = "CROSSWIND (M/S)";
    }
}

// Function to update location-dependent data
async function updateLocationData(lat, long) {
    customLog('Updating location dependent data for (', lat, ', ', long, ')');
    neverUpdatedLocation = false;

    // Fire off API requests for external data
    // updateTimeZone(lat, long);
    fetchCityData(lat, long);

    // Update connectivity data iff the Network section is visible
    // const networkSection = document.getElementById("network");
    // if (networkSection.style.display === "block") {
    //     customLog('Updating connectivity data...');
    //     updateNetworkInfo();
    // }

    // Update Wikipedia data iff the Landmarks section is visible
    const locationSection = document.getElementById("landmarks");
    if (locationSection.style.display === "block") {
        customLog('Updating Wikipedia data...');
        fetchLandmarkData(lat, long);
    }
}

// Function to determine if short-range data should be updated
function shouldUpdateShortRangeData() {
    if (neverUpdatedLocation || !lastUpdateLat || !lastUpdateLong) {
        return true;
    }

    const now = Date.now();
    const timeSinceLastUpdate = (now - lastUpdate) / (1000 * 60); // Convert to minutes
    const distance = calculateDistance(lat, long, lastUpdateLat, lastUpdateLong);

    return distance >= UPDATE_DISTANCE_THRESHOLD || timeSinceLastUpdate >= UPDATE_TIME_THRESHOLD;
}

// Function to determine if long-range data should be updated
function shouldUpdateLongRangeData() {
    // Check if we've never updated weather data
    if (lastWxUpdate === 0 || lastWxUpdateLat === null || lastWxUpdateLong === null) {
        return true;
    }

    // Check time threshold using WX_TIME_THRESHOLD constant
    const now = Date.now();
    const timeSinceLastUpdate = now - lastWxUpdate;
    if (timeSinceLastUpdate >= WX_TIME_THRESHOLD * 60 * 1000) { // Convert minutes to milliseconds
        return true;
    }

    // Check distance threshold using WX_DISTANCE_THRESHOLD constant
    if (lat !== null && long !== null) {
        const distance = calculateDistance(lat, long, lastWxUpdateLat, lastWxUpdateLong);
        if (distance >= WX_DISTANCE_THRESHOLD) { // Use constant for meters
            return true;
        }
    }

    // No need to update weather data
    return false;
}

// Function to handle position updates from GPS
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

        // Update display values with proper units
        if (alt) {
            if (!settings || settings["imperial-units"]) {
                // Convert meters to feet
                document.getElementById('altitude').innerText = Math.round(alt * 3.28084);
                document.getElementById('altitude-unit').innerText = 'FT';
            } else {
                document.getElementById('altitude').innerText = Math.round(alt);
                document.getElementById('altitude-unit').innerText = 'M';
            }
        } else {
            document.getElementById('altitude').innerText = '--';
        }

        document.getElementById('accuracy').innerText = acc ? Math.round(acc) + ' m' : '--';

        // Update headwind/crosswind labels
        if (!settings || settings["imperial-units"]) {
            document.getElementById('headwind-label').innerText =
                document.getElementById('headwind-label').innerText.replace("(MPH)", "(MPH)");
            document.querySelector('.stat-box:nth-child(4) .stat-label').innerText =
                document.querySelector('.stat-box:nth-child(4) .stat-label').innerText.replace("(MPH)", "(MPH)");
        } else {
            document.getElementById('headwind-label').innerText =
                document.getElementById('headwind-label').innerText.replace("(MPH)", "(M/S)");
            document.querySelector('.stat-box:nth-child(4) .stat-label').innerText =
                document.querySelector('.stat-box:nth-child(4) .stat-label').innerText.replace("(MPH)", "(M/S)");
        }
    }

    // Short distance updates
    if (shouldUpdateShortRangeData()) {
        updateLocationData(lat, long);
        lastUpdateLat = lat;
        lastUpdateLong = long;
        lastUpdate = Date.now();
    }

    // Long distance updates
    if (shouldUpdateLongRangeData()) {
        updateTimeZone(lat, long);
        fetchWeatherData(lat, long);
        lastWxUpdateLat = lat;
        lastWxUpdateLong = long;
        lastWxUpdate = Date.now();
    }
}

// Function to update GPS data
function updateGPS() {
    if (!testMode) {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(handlePositionUpdate);
        } else {
            customLog('Geolocation is not supported by this browser.');
            return false;
        }
    } else { // testing
        handlePositionUpdate(positionSimulator.getPosition());
    }
    return true;
}

// Function to throttle GPS updates
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
        if (updateGPS()) { // Call immediately and check if browser supports
            gpsIntervalId = setInterval(throttledUpdateGPS, 1000 * LATLON_UPDATE_INTERVAL);
            customLog('GPS updates started');
        }
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

// Check for NOTE file and display if present
function updateServerNote() {
    fetch('NOTE', { cache: 'no-store' })
        .then(response => {
            if (!response.ok) {
                throw new Error('NOTE file not found');
            }
            return response.text();
        })
        .then(content => {
            // Sanitize the content to prevent XSS
            const sanitizedContent = document.createElement('div');
            sanitizedContent.textContent = content;

            // Update the note paragraph with the sanitized content in italic
            const noteElement = document.getElementById('note');
            noteElement.innerHTML = sanitizedContent.innerHTML;

            // Show the announcement section
            const announcementSection = document.getElementById('announcement');
            if (announcementSection) {
                announcementSection.style.display = 'block';
            }

            // Add notification dot to About section if it's not the current section
            const aboutSection = document.getElementById('about');
            if (aboutSection && aboutSection.style.display !== 'block') {
                const aboutButton = document.querySelector('.section-button[onclick="showSection(\'about\')"]');
                if (aboutButton) {
                    aboutButton.classList.add('has-notification');
                }
            }
        })
        .catch(error => {
            customLog('No NOTE file available: ', error);
        });
}

// Show git version from vers.php
function updateVersion() {
    const versionElement = document.getElementById('version');
    if (versionElement) {
        fetch('vers.php')
            .then(response => response.json())
            .then(data => {
                const versionText = `${data.branch || 'unknown'}-${data.commit || 'unknown'}`;
                versionElement.innerHTML = versionText;
            })
            .catch(error => {
                console.error('Error fetching version:', error);
                versionElement.innerHTML = 'Error loading version';
            });
    }
}

// Function to load an external URL in a new tab or frame
window.loadExternalUrl = function (url, inFrame = false) {
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

// Show a specific section and update URL - defined directly on window object
window.showSection = function (sectionId) {
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
        setUserHasSeenLatestNews(true);
        const newsButton = document.querySelector('.section-button[onclick="showSection(\'news\')"]');
        if (newsButton) {
            newsButton.classList.remove('has-notification');
        }
    }

    // If switching to about section, clear the notification dot
    if (sectionId === 'about') {
        const aboutButton = document.querySelector('.section-button[onclick="showSection(\'about\')"]');
        if (aboutButton) {
            aboutButton.classList.remove('has-notification');
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

    // Activate the clicked button
    const button = document.querySelector(`.section-button[onclick="showSection('${sectionId}')"]`);
    if (button) {
        button.classList.add('active');
    }

    // Handle initialization of the selected section
    // TODO: Have a set of functions to run when a section loads and when it leaves
    const section = document.getElementById(sectionId);
    if (section) {
        section.style.display = 'block';

        if (sectionId === 'navigation' && testMode) {
            // In test mode, replace TeslaWaze iframe with "TESTING MODE" message
            const teslaWazeContainer = document.querySelector('.teslawaze-container');
            if (teslaWazeContainer) {
                const iframe = teslaWazeContainer.querySelector('iframe');
                if (iframe) {
                    iframe.style.display = 'none';

                    // Check if our test mode message already exists
                    let testModeMsg = teslaWazeContainer.querySelector('.test-mode-message');
                    if (!testModeMsg) {
                        // Create and add the test mode message
                        testModeMsg = document.createElement('div');
                        testModeMsg.className = 'test-mode-message';
                        testModeMsg.style.cssText = 'display: flex; justify-content: center; align-items: center; height: 100%; font-size: 32px; font-weight: bold;';
                        testModeMsg.textContent = 'TESTING MODE';
                        teslaWazeContainer.appendChild(testModeMsg);
                    } else {
                        testModeMsg.style.display = 'flex';
                    }
                }
            }
        } else if (sectionId === 'navigation') {
            // Normal mode - ensure iframe is visible and test mode message is hidden
            const teslaWazeContainer = document.querySelector('.teslawaze-container');
            if (teslaWazeContainer) {
                const iframe = teslaWazeContainer.querySelector('iframe');
                const testModeMsg = teslaWazeContainer.querySelector('.test-mode-message');

                if (iframe) iframe.style.display = '';
                if (testModeMsg) testModeMsg.style.display = 'none';
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
            if (!networkInfoUpdated) {
                updateNetworkInfo();
                networkInfoUpdated = true;
            }
        }

        if (sectionId === 'landmarks') {
            if (lat !== null && long !== null) {
                fetchLandmarkData(lat, long);
            } else {
                customLog('Location not available for Wikipedia data.');
            }
        }
    }
};


// ***** Main code *****

// Console logging
customLog('*** app.js top level code ***');

// Update link click event listener
document.addEventListener('click', function (e) {
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

// Handle page visibility changes
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        stopGPSUpdates();
        pauseNewsUpdates();
        pausePingTest();
    } else {
        startGPSUpdates();
        resumeNewsUpdates();
        resumePingTest();
    }
});

// Event listeners and initialization after DOM content is loaded
document.addEventListener('DOMContentLoaded', async function () {
    // Log
    customLog('DOM fully loaded and parsed...');

    // Attempt login from URL parameter or cookie
    await attemptLogin();

    // Check for NOTE file and display if present
    updateServerNote();

    // Initialize radar display
    initializeRadar();

    // Start location services
    startGPSUpdates();

    // Start news updates
    resumeNewsUpdates();

    // Begin network sensing
    startPingTest();

    // Get version from vers.php asyncly
    updateVersion();

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
    const urlParams = new URLSearchParams(window.location.search);
    const initialSection = urlParams.get('section') || 'news';
    showSection(initialSection);
});
