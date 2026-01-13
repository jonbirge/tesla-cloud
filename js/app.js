// Imports
import { srcUpdate, testMode, debugMode, isTestMode, updateTimeZone, GEONAMES_USERNAME, showNotification, gpsPermissionDenied, setGpsPermissionDenied, setUsingIPLocation } from './common.js';
import { PositionSimulator } from './location.js';
import { attemptLogin, leaveSettings, settings, isDriving, setDrivingState, enableLiveNewsUpdates, saveSetting, startDarkModeChecks, stopDarkModeChecks, autoDarkMode } from './settings.js';
import { fetchPremiumWeatherData, fetchCityData, SAT_URLS, forecastDataPrem, currentRainAlert, generateForecastDayElements, ensurePrecipitationGraphWidth, currentSatRegion } from './wx.js';
import { updateNetworkInfo, updatePingChart, startPingTest, getIPBasedLocation } from './net.js';
import { setupNewsObserver, cleanupNewsObserver, startNewsTimeUpdates, stopNewsTimeUpdates, initializeNewsStorage } from './news.js';
import { startStockUpdates, stopStockUpdates } from './stock.js';
import { initMarketSection, stopMarketUpdates } from './market.js';

// Exports
export { currentSection };

// Parameters
const DEFAULT_SECTION = 'navigation';               // Default section to show
const LATLON_UPDATE_INTERVAL = 2;                   // seconds
const UPDATE_DISTANCE_THRESHOLD = 2500;             // meters
const UPDATE_TIME_THRESHOLD = 10;                   // minutes
const UPDATE_TIME_THRESHOLD_RAIN = 1;               // minutes (when rain is predicted)
const WX_DISTANCE_THRESHOLD = 25000;                // meters
const WX_TIME_THRESHOLD = 60;                       // minutes
const MAX_SPEED = 50;                               // Max speed for wind display (mph)
const MIN_GPS_UPDATE_INTERVAL = 1000;               // ms - minimum time between updates
const MAX_GPS_RETRIES = 3;                          // Max consecutive GPS failures before giving up
const WIKI_TYPES = ['event','airport','landmark'];  // Types of Wikipedia data to fetch
const ENABLE_SPEED_DISABLE = false;                 // Set to false to disable speed-based section disabling
const SPEED_DISABLE_THRESHOLD = 1.5;                // Speed in mph above which disabling occurs

// Module variables
let currentSection = null;                          // Track the current section
let lastUpdate = 0;                                 // Timestamp of last location update
let lat = null;
let long = null;
let alt = null;
let acc = null;
let speed = null;
let lastUpdateLat = null;
let lastUpdateLong = null;
let lastKnownHeading = null;
let lastLongUpdate = 0;
let lastLongUpdateLat = null;
let lastLongUpdateLong = null;
let neverUpdatedLocation = true;
let radarContext = null;
let gpsIntervalId = null;
let lastGPSUpdate = 0;
let gpsFailureCount = 0;                            // Count consecutive GPS failures
let networkInfoUpdated = false;                     // Track if network info has been updated
let previousAlt = null;                             // Previous altitude for vertical rate calculation
let previousAltTime = null;                         // Timestamp of previous altitude measurement
const positionSimulator = new PositionSimulator();  // TODO: only create if needed

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

// Helper function to show error message for landmarks
function showLandmarksError(message) {
    document.getElementById('landmarks-loading').style.display = 'none';
    const items = document.getElementById('landmark-items');
    items.style.display = 'block';
    items.replaceChildren();
    const p = document.createElement('p');
    const em = document.createElement('em');
    em.textContent = message;
    p.appendChild(em);
    items.appendChild(p);
}

// Function to fetch nearby Wikipedia data based on coordinates
async function fetchLandmarkData(lat, long) {
    console.log('Fetching Wikipedia data...');
    
    // Show loading spinner and hide content
    const landmarkDiv = document.getElementById('landmark-items');
    const loadingSpinner = document.getElementById('landmarks-loading');
    
    if (loadingSpinner) loadingSpinner.style.display = 'flex';
    if (landmarkDiv) landmarkDiv.style.display = 'none';
    
    const baseUrl = 'https://secure.geonames.org/findNearbyWikipediaJSON';
    const url =
    `${baseUrl}?lat=${lat}&lng=${long}&radius=10&maxRows=50&username=${GEONAMES_USERNAME}`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        
        // Hide loading spinner and show content
        if (loadingSpinner) loadingSpinner.style.display = 'none';
        if (landmarkDiv) landmarkDiv.style.display = 'block';
        
        if (data.geonames && data.geonames.length > 0) {
            const list = document.createElement('ul');
            data.geonames.forEach(article => {
                // Add article if it matches the specified types
                if (WIKI_TYPES.includes(article.feature)) {
                    const pageUrl = article.wikipediaUrl.startsWith('http') ? article.wikipediaUrl : 'http://' + article.wikipediaUrl;
                    const li = document.createElement('li');
                    const a = document.createElement('a');
                    a.href = pageUrl;
                    a.target = '_blank';
                    a.rel = 'noopener noreferrer';
                    a.textContent = article.title;
                    li.appendChild(a);
                    li.appendChild(document.createTextNode(`: ${article.summary}`));
                    list.appendChild(li);
                }
            });
            landmarkDiv.replaceChildren(list);
        } else {
            const p = document.createElement('p');
            const em = document.createElement('em');
            em.textContent = 'No nearby landmarks found.';
            p.appendChild(em);
            landmarkDiv.replaceChildren(p);
        }
    } catch (error) {
        console.error('Error fetching Wikipedia data:', error);
        
        // Hide loading spinner and show error message
        if (loadingSpinner) loadingSpinner.style.display = 'none';
        if (landmarkDiv) {
            landmarkDiv.style.display = 'block';
            const p = document.createElement('p');
            const em = document.createElement('em');
            em.textContent = 'Error loading landmark data.';
            p.appendChild(em);
            landmarkDiv.replaceChildren(p);
        }
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
    if (vehicleHeading !== null && vehicleHeading !== undefined && windDirection !== null && windDirection !== undefined) {  // Threshold for meaningful motion    
        const windAngle = (windDirection + 180) - vehicleHeading; // car frame
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
            document.getElementById('headwind-unit').innerText = 'MPH';
        } else {
            // Convert mph to m/s (1 mph ≈ 0.44704 m/s)
            document.getElementById('headwind').innerText = Math.abs(Math.round(headWind * 0.44704));
            document.getElementById('headwind-unit').innerText = 'M/S';
        }
        document.getElementById('headwind-arrow').textContent = (headWind > 0 ? '▼' : '▲'); // down/up filled triangles
        // Change the label to TAILWIND when headWind is negative
        document.getElementById('headwind-label').innerText = (headWind < 0) ? "TAILWIND" : "HEADWIND";
    } else {
        document.getElementById('headwind').innerText = '--';
        document.getElementById('headwind-arrow').textContent = '';
        document.getElementById('headwind-label').innerText = "HEADWIND";
        // Set unit with appropriate units
        if (!settings || settings["imperial-units"]) {
            document.getElementById('headwind-unit').innerText = 'MPH';
        } else {
            document.getElementById('headwind-unit').innerText = 'M/S';
        }
    }

    if (crossWind !== null) {
        if (!settings || settings["imperial-units"]) {
            document.getElementById('crosswind').innerText = Math.abs(Math.round(crossWind));
            document.getElementById('crosswind-unit').innerText = 'MPH';
        } else {
            // Convert mph to m/s
            document.getElementById('crosswind').innerText = Math.abs(Math.round(crossWind * 0.44704));
            document.getElementById('crosswind-unit').innerText = 'M/S';
        }
        document.getElementById('crosswind-arrow').textContent = (crossWind >= 0 ? '▶' : '◀'); // right/left triangles
    } else {
        document.getElementById('crosswind').innerText = '--';
        document.getElementById('crosswind-arrow').textContent = '';
    }
    // Set crosswind unit with appropriate units
    if (!settings || settings["imperial-units"]) {
        document.getElementById('crosswind-unit').innerText = 'MPH';
    } else {
        document.getElementById('crosswind-unit').innerText = 'M/S';
    }
}

// Function to update location-dependent data
async function updateLocationData(lat, long) {
    console.log('Updating location dependent data for (', lat, ', ', long, ')');
    neverUpdatedLocation = false;

    // Fire off API requests for external data
    fetchCityData(lat, long);

    // Update Wikipedia data iff the Landmarks section is visible
    const locationSection = document.getElementById("landmarks");
    if (locationSection.style.display === "block") {
        console.log('Updating Wikipedia data...');
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
    
    // Use shorter time threshold when rain is predicted in the minutely forecast
    const timeThreshold = currentRainAlert ? UPDATE_TIME_THRESHOLD_RAIN : UPDATE_TIME_THRESHOLD;
    
    // Log when we're using the rain-based update interval
    if (currentRainAlert && timeSinceLastUpdate >= timeThreshold) {
        console.log(`Rain detected: Using shorter weather update interval (${UPDATE_TIME_THRESHOLD_RAIN} minutes)`);
    }
    
    return distance >= UPDATE_DISTANCE_THRESHOLD || timeSinceLastUpdate >= timeThreshold;
}

// Function to determine if long-range data should be updated
function shouldUpdateLongRangeData() {
    // Check if we've never updated weather data
    if (lastLongUpdate === 0 || lastLongUpdateLat === null || lastLongUpdateLong === null) {
        return true;
    }

    // Check time threshold using WX_TIME_THRESHOLD constant
    const now = Date.now();
    const timeSinceLastUpdate = now - lastLongUpdate;
    if (timeSinceLastUpdate >= WX_TIME_THRESHOLD * 60 * 1000) { // Convert minutes to milliseconds
        return true;
    }

    // Check distance threshold using WX_DISTANCE_THRESHOLD constant
    if (lat !== null && long !== null) {
        const distance = calculateDistance(lat, long, lastLongUpdateLat, lastLongUpdateLong);
        if (distance >= WX_DISTANCE_THRESHOLD) { // Use constant for meters
            return true;
        }
    }

    // No need to update weather data
    return false;
}

// Function to handle position updates from GPS
async function handlePositionUpdate(position) {
    // Reset GPS failure count on successful position update
    gpsFailureCount = 0;

    // Clear IP location flag since we're using GPS
    setUsingIPLocation(false);
    
    lat = position.coords.latitude;
    long = position.coords.longitude;
    alt = position.coords.altitude;
    acc = position.coords.accuracy;
    speed = position.coords.speed / 0.44704; // Convert m/s to mph
    if (position.coords.heading !== null && position.coords.heading !== undefined && !isNaN(position.coords.heading)) {
        lastKnownHeading = position.coords.heading;
    }

    // Update GPS status indicator based on GPS accuracy
    const gpsStatusElement = document.getElementById('gps-status');
    if (gpsStatusElement) {
        gpsStatusElement.classList.remove('hidden', 'unavailable', 'poor', 'fair', 'good', 'excellent');
        
        // Set class based on accuracy thresholds
        if (acc >= 50) {
            gpsStatusElement.classList.add('poor');
            gpsStatusElement.title = `GPS Accuracy: Poor (${Math.round(acc)}m)`;
        } else if (acc >= 25) {
            gpsStatusElement.classList.add('fair');
            gpsStatusElement.title = `GPS Accuracy: Fair (${Math.round(acc)}m)`;
        } else if (acc >= 10) {
            gpsStatusElement.classList.add('good');
            gpsStatusElement.title = `GPS Accuracy: Good (${Math.round(acc)}m)`;
        } else {
            gpsStatusElement.classList.add('excellent');
            gpsStatusElement.title = `GPS Accuracy: Excellent (${Math.round(acc)}m)`;
        }
    }

    // Update wind display if nav section is visible
    const navigationSection = document.getElementById("navigation");
    if (navigationSection.style.display === "block") {
        // Update heading displays
        if (lastKnownHeading !== null && lastKnownHeading !== undefined) {
            document.getElementById('heading').innerText = Math.round(lastKnownHeading) + '°';
            if (forecastDataPrem && forecastDataPrem.current) {
                const windSpeedMPH = Math.min((forecastDataPrem.current.wind_speed * 2.237), MAX_SPEED);
                const windDir = forecastDataPrem.current.wind_deg;
                updateWindage(speed, lastKnownHeading, windSpeedMPH, windDir);
            } else {
                updateWindage(speed, lastKnownHeading, 0, 0);
            }
        } else {
            document.getElementById('heading').innerText = '--';
            updateWindage(0, null, 0, 0);
        }

        // Update display values with proper units
        if (alt !== null) {
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

        // Update speed display
        if (speed !== null && speed !== undefined) {
            if (!settings || settings["imperial-units"]) {
                document.getElementById('speed').innerText = Math.round(speed);
                document.getElementById('speed-unit').innerText = 'MPH';
            } else {
                // Convert mph to kph (1 mph ≈ 1.60934 kph)
                document.getElementById('speed').innerText = Math.round(speed * 1.60934);
                document.getElementById('speed-unit').innerText = 'KPH';
            }
        } else {
            document.getElementById('speed').innerText = '--';
        }

        // Calculate and update vertical rate
        if (alt !== null && previousAlt !== null && previousAltTime !== null) {
            const now = Date.now();
            const timeDiffSeconds = (now - previousAltTime) / 1000;

            // Only calculate if enough time has passed (at least 2 seconds)
            if (timeDiffSeconds >= 2) {
                const altDiffMeters = alt - previousAlt;
                const verticalRateMs = altDiffMeters / timeDiffSeconds; // m/s

                if (!settings || settings["imperial-units"]) {
                    // Convert m/s to ft/min (1 m/s ≈ 196.85 ft/min)
                    const verticalRateFtMin = verticalRateMs * 196.85;
                    document.getElementById('vertical-rate').innerText = Math.abs(Math.round(verticalRateFtMin));
                    document.getElementById('vertical-rate-arrow').textContent = (verticalRateFtMin > 0 ? '▲' : '▼');
                    document.getElementById('vertical-rate-unit').innerText = 'FT/MIN';
                } else {
                    document.getElementById('vertical-rate').innerText = Math.abs(verticalRateMs.toFixed(1));
                    document.getElementById('vertical-rate-arrow').textContent = (verticalRateMs > 0 ? '▲' : '▼');
                    document.getElementById('vertical-rate-unit').innerText = 'M/S';
                }

                // Update previous altitude and time
                previousAlt = alt;
                previousAltTime = now;
            }
        } else if (alt !== null) {
            // Initialize previous altitude and time
            previousAlt = alt;
            previousAltTime = Date.now();
            document.getElementById('vertical-rate').innerText = '--';
            document.getElementById('vertical-rate-arrow').textContent = '';
        } else {
            document.getElementById('vertical-rate').innerText = '--';
            document.getElementById('vertical-rate-arrow').textContent = '';
        }

        document.getElementById('accuracy').innerText = acc ? Math.round(acc) + ' m' : '--';
    }

    // Handle whether or not we're driving
    // Always track driving state (used for features like news forwarding)
    const wasDriving = isDriving;
    const currentlyDriving = speed > SPEED_DISABLE_THRESHOLD;
    
    if (currentlyDriving && !wasDriving) {
        startedDriving();
        setDrivingState(true);
    } else if (!currentlyDriving && wasDriving) {
        stoppedDriving();
        setDrivingState(false);
    } else if (currentlyDriving !== wasDriving) {
        // Update state even if transition handlers weren't called
        setDrivingState(currentlyDriving);
    }

    // Long distance updates (happens rarely)
    if (shouldUpdateLongRangeData()) {
        await updateTimeZone(lat, long);
        lastLongUpdateLat = lat;
        lastLongUpdateLong = long;
        lastLongUpdate = Date.now();
    }

    // Short distance updates (happens often)
    if (shouldUpdateShortRangeData()) {
        await updateLocationData(lat, long);
        fetchPremiumWeatherData(lat, long);
        lastUpdateLat = lat;
        lastUpdateLong = long;
        lastUpdate = Date.now();
    }
}

// Function called when user starts driving
function startedDriving() {
    console.log('*** Started driving ***');
    // Only disable sections if speed-based disabling is enabled and speed is above threshold
    if (ENABLE_SPEED_DISABLE && speed > SPEED_DISABLE_THRESHOLD) {
        const noDrivingButtons = document.querySelectorAll('.no-driving');
        noDrivingButtons.forEach(button => {
            button.classList.add('disabled');
            button.disabled = true;
        });
    }
}

// Function called when user stops driving
function stoppedDriving() {
    console.log('*** Stopped driving ***');
    // Only enable sections if speed-based disabling is enabled
    if (ENABLE_SPEED_DISABLE) {
        const noDrivingButtons = document.querySelectorAll('.no-driving');
        noDrivingButtons.forEach(button => {
            button.classList.remove('disabled');
            button.disabled = false;
        });
    }
}

// Function to update GPS data
function updateGPS() {
    // Don't try GPS if permission was denied or max retries exceeded
    if (gpsPermissionDenied || gpsFailureCount >= MAX_GPS_RETRIES) {
        return false;
    }
    
    if (!isTestMode('gps')) {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(handlePositionUpdate, handleGPSError);
        } else {
            console.log('Geolocation is not supported by this browser.');
            return false;
        }
    } else { // GPS testing mode
        console.log('TEST MODE (gps): Using simulated GPS position');
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
        console.log('Skipping rapid GPS update');
    }
}

// Function to start the GPS updates
function startGPSUpdates() {
    if (!gpsIntervalId) {
        if (updateGPS()) { // Call immediately and check if browser supports
            gpsIntervalId = setInterval(throttledUpdateGPS, 1000 * LATLON_UPDATE_INTERVAL);
            console.log('GPS updates started');
        }
    }
}

// Function to stop the GPS updates
function stopGPSUpdates() {
    if (gpsIntervalId) {
        clearInterval(gpsIntervalId);
        gpsIntervalId = null;
        console.log('GPS updates paused');
    }
}

// Function to handle GPS errors gracefully
function handleGPSError(error) {
    gpsFailureCount++;
    console.log(`GPS error (attempt ${gpsFailureCount}/${MAX_GPS_RETRIES}):`, error.message);
    
    // Check error type
    if (error.code === error.PERMISSION_DENIED) {
        setGpsPermissionDenied(true);
        console.log('GPS permission denied by user');
    }
    
    // Update GPS status indicator to show error state
    const gpsStatusElement = document.getElementById('gps-status');
    if (gpsStatusElement) {
        gpsStatusElement.classList.remove('poor', 'fair', 'good', 'excellent', 'hidden');
        gpsStatusElement.classList.add('unavailable');
        if (gpsPermissionDenied) {
            gpsStatusElement.title = 'GPS Permission Denied';
        } else {
            gpsStatusElement.title = 'GPS Error: ' + error.message;
        }
    }

    // If GPS was denied by user, update the "GPS Accuracy" display to say "Denied"
    if (gpsPermissionDenied) {
        document.getElementById('accuracy').innerText = 'DENIED';
        document.getElementById('accuracy').style.color = 'red';
    }
    
    // Stop GPS updates if permission denied or max retries exceeded
    if (gpsPermissionDenied || gpsFailureCount >= MAX_GPS_RETRIES) {
        console.log('Stopping GPS updates due to permission denial or max retries exceeded');
        stopGPSUpdates();
    }
}

// Check for NOTE file and display if present (now via PHP endpoint to avoid 404s)
function updateServerNote() {
    fetch('php/get_note.php', { cache: 'no-store' })
        .then(response => {
            if (!response.ok) throw new Error('Network response not ok');
            return response.json();
        })
        .then(data => {
            const content = (data && typeof data.note === 'string') ? data.note.trim() : '';
            const mtime = (data && typeof data.mtime === 'number') ? data.mtime : null;
            const noteHash = (data && typeof data.md5 === 'string') ? data.md5 : null;
            const noteElement = document.getElementById('note');
            const announcementSection = document.getElementById('announcement');
            const aboutButton = document.getElementById('about-section');

            if (content && noteElement && announcementSection) {
                // Clear existing content
                noteElement.replaceChildren();

                // Store the note hash in the note element for later retrieval
                if (noteHash) {
                    noteElement.setAttribute('data-note-hash', noteHash);
                }

                // If mtime available, create a right-justified date "cell"
                if (mtime) {
                    try {
                        const dateStr = new Date(mtime * 1000).toLocaleDateString();
                        const dateSpan = document.createElement('span');
                        dateSpan.className = 'note-date';
                        dateSpan.textContent = dateStr;
                        noteElement.appendChild(dateSpan);
                    } catch (e) {
                        // ignore date if conversion fails
                    }
                }

                // Create the note text cell with italic content
                const textSpan = document.createElement('span');
                textSpan.className = 'note-text';
                const em = document.createElement('em');
                em.textContent = content;
                textSpan.appendChild(em);
                noteElement.appendChild(textSpan);

                announcementSection.style.display = 'block';

                // Check if user has already seen this note before showing notification
                const lastSeenHash = settings['last-note-hash-seen'];
                const shouldShowNotification = !noteHash || !lastSeenHash || noteHash !== lastSeenHash;

                if (aboutButton && shouldShowNotification) {
                    aboutButton.classList.add('has-notification');
                    aboutButton.setAttribute('data-count', '1');
                } else if (aboutButton) {
                    aboutButton.classList.remove('has-notification');
                    aboutButton.removeAttribute('data-count');
                }
            } else {
                // No note: ensure announcement is hidden and no notification dot
                if (announcementSection) announcementSection.style.display = 'none';
                if (aboutButton) {
                    aboutButton.classList.remove('has-notification');
                    aboutButton.removeAttribute('data-count');
                }
            }
        })
        .catch(error => {
            console.log('Could not retrieve server note:', error);
            // Ensure the announcement section is hidden on error
            const announcementSection = document.getElementById('announcement');
            if (announcementSection) announcementSection.style.display = 'none';
        });
}

// Show a test notification for testing the notification system
function showTestNotification() {
    console.log('TEST MODE (note): Displaying three test notifications with different lengths');
    
    // Short notification
    showNotification('Lorem ipsum dolor sit amet.', 'info');
    
    // Medium notification after 1.5 seconds
    setTimeout(() => {
        showNotification('Lorem ipsum dolor sit amet, consectetur adipiscing elit sed do eiusmod tempor.', 'success');
    }, 1000);
    
    // Long notification after 3 seconds
    setTimeout(() => {
        showNotification('Lorem ipsum dolor sit amet! Consectetur adipiscing elit.', 'warning');
    }, 2000);
}

// Show git version from php/vers.php
function updateVersion() {
    const versionElement = document.getElementById('version');
    if (versionElement) {
        fetch('php/vers.php')
            .then(response => response.json())
            .then(data => {
                let versionText = '';
                
                // Use tag if available, otherwise branch-commit
                if (data.tag) {
                    versionText = `${data.tag} (${data.commit || 'unknown'})`;
                } else {
                    versionText = `${data.branch || 'unknown'}-${data.commit || 'unknown'}`;
                }
                
                // Add diagnostic tooltip if available
                if (data.diagnostic) {
                    const diagnosticInfo = `Method: ${data.diagnostic.method}, Git Available: ${data.diagnostic.git_available ? 'Yes' : 'No'}`;
                    versionElement.title = diagnosticInfo;
                    
                    // Add error info if any errors occurred
                    if (data.diagnostic.errors && data.diagnostic.errors.length > 0) {
                        versionElement.title += `, Errors: ${data.diagnostic.errors.join(', ')}`;
                    }
                }
                
                versionElement.textContent = versionText;
            })
            .catch(error => {
                console.error('Error fetching version:', error);
                versionElement.textContent = 'Error loading version';
            });
    }
}

// Function to update scroll indicators
function updateScrollIndicators() {
    const rightFrame = document.getElementById('rightFrame');
    const topFade = document.getElementById('top-fade');
    const bottomFade = document.getElementById('bottom-fade');

    if (!topFade || !bottomFade) return;

    const isMobile = window.matchMedia("only screen and (max-width: 900px)").matches;
    const scrollElement = isMobile ? document.documentElement : rightFrame;

    if (!scrollElement) return;

    // Check if we can scroll up (we've scrolled down from the top)
    const canScrollUp = scrollElement.scrollTop > 5;

    // Check if we can scroll down (there's more content below)
    const canScrollDown = (scrollElement.scrollHeight - scrollElement.clientHeight - scrollElement.scrollTop) > 5;
    
    // Update fade visibility
    topFade.style.opacity = canScrollUp ? '1' : '0';
    bottomFade.style.opacity = canScrollDown ? '1' : '0';
}

// Function to handle mobile-specific section visibility
function updateMobileSectionVisibility() {
    const isMobile = window.matchMedia("only screen and (max-width: 900px)").matches;
    
    // Sections to hide on mobile: Dashboard (navigation), Media, Reference
    const mobileSections = ['navigation', 'media', 'reference'];
    
    mobileSections.forEach(sectionId => {
        const button = document.querySelector(`.section-button[onclick="showSection('${sectionId}')"]`);
        if (button) {
            if (isMobile) {
                button.style.display = 'none';
            } else {
                button.style.display = '';
            }
        }
    });
    
    // If current section is hidden on mobile, switch to a visible section
    if (isMobile && currentSection && mobileSections.includes(currentSection)) {
        // Use 'news' as the fallback since it's always visible on mobile
        showSection('news');
    }
}

// Function to handle scroll events on the right frame
function handleScrollScale() {
    const rightFrame = document.getElementById('rightFrame');
    const controlContainer = document.querySelector('.control-container');
    const scrollTopBtn = document.getElementById('scroll-to-top');

    // Check if we're on a mobile screen
    const isMobile = window.matchMedia("only screen and (max-width: 900px)").matches;
    const scrollElement = isMobile ? document.documentElement : rightFrame;

    // Update scroll indicators regardless of device type
    updateScrollIndicators();

    // Show or hide scroll-to-top button on mobile
    if (scrollTopBtn) {
        scrollTopBtn.style.display = (isMobile && scrollElement.scrollTop > 100) ? 'block' : 'none';
    }

    // If mobile, maintain a fixed small scale and exit
    if (isMobile) {
        if (controlContainer) {
            controlContainer.style.transformOrigin = 'top right';
        }
        return; // Exit early, let CSS handle the fixed scaling
    }

    // Desktop behavior continues below
    // Define the threshold where scaling starts (pixels from top)
    const scrollThreshold = 60;

    // Get current scroll position
    const scrollTop = scrollElement.scrollTop;

    if (scrollTop < scrollThreshold) {
        // Calculate scale factor between 1 and 2 based on scroll position
        const scaleFactor = 1 + 0.25*((scrollThreshold - scrollTop) / scrollThreshold);

        // Apply transformation with top-right anchoring to keep both top and right positions fixed
        if (controlContainer) {
            controlContainer.style.transformOrigin = 'top right';
            controlContainer.style.transform = `scale(${scaleFactor})`;
        }
    } else {
        // Reset to normal size when scrolled past threshold
        if (controlContainer) controlContainer.style.transform = 'scale(1)';
    }
}

// Function to update the src of an iframe
window.updateMapFrame = function () {
    // Normal mode - ensure iframe is visible and test mode message is hidden
    const teslaWazeContainer = document.querySelector('.teslawaze-container');
    const iframe = teslaWazeContainer.querySelector('iframe');
    let testModeMsg = teslaWazeContainer.querySelector('.test-mode-message');
    if (settings["map-choice"] === 'waze') {
        srcUpdate("teslawaze", "https://teslawaze.azurewebsites.net/");
    } else if (settings["map-choice"] === 'rainmap') {
        srcUpdate("teslawaze", "https://car.rainviewer.com/");
    } else {
        srcUpdate("teslawaze", "https://abetterrouteplanner.com/");
    }
    iframe.style.display = '';
    if (testModeMsg) testModeMsg.style.display = 'none';
}

// Function to load an external URL in a new tab or frame
window.loadExternalUrl = function (url, inFrame = false) {
    // Open external links in a new tab
    if (!inFrame) {
        window.open(url, '_blank');
        return;
    }

    // Hide all sections first
    const sections = document.querySelectorAll('.section');
    sections.forEach(section => {
        section.style.display = 'none';
    });
    
    // Get the external-site container
    const externalSite = document.getElementById('external-site');
    
    // Clear any existing content
    externalSite.replaceChildren();
    
    // Create and load iframe
    const iframe = document.createElement('iframe');
    iframe.setAttribute('allow', 'geolocation; fullscreen');
    iframe.src = url;
    externalSite.appendChild(iframe);
    
    // Add close button for mobile devices
    if (window.innerWidth <= 900) {
        const closeButton = document.createElement('button');
        closeButton.innerHTML = '✕ Close';
        closeButton.style.cssText = `
            position: absolute;
            top: 10px;
            right: 10px;
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 8px 12px;
            border-radius: 20px;
            border: none;
            z-index: 1001;
            font-size: 14px;
            font-weight: bold;
            cursor: pointer;
        `;
        
        closeButton.addEventListener('click', function() {
            // Close external site by showing the previous section
            const urlParams = new URLSearchParams(window.location.search);
            const currentSectionFromUrl = urlParams.get('section') || 'navigation';
            showSection(currentSectionFromUrl);
        });
        
        externalSite.appendChild(closeButton);
    }
    
    // Show the external site container
    externalSite.style.display = 'block';
    
    // Flag the right frame as being in external mode
    const rightFrame = document.getElementById('rightFrame');
    rightFrame.classList.add('external');
    
    // Deactivate current section button
    // const activeButton = document.querySelector('.section-button.active');
    // if (activeButton) {
    //     activeButton.classList.remove('active');
    // }
}

// Show a specific section and update URL - defined directly on window object
window.showSection = function (sectionId) {
    const rightFrame = document.getElementById('rightFrame');
    
    // Check if we're actually going anywhere
    if (currentSection === sectionId && !rightFrame.classList.contains('external')) {
        console.log(`Already in section: ${sectionId}`);
        return;
    }

    // Log the clicked section
    console.log(`Showing section: ${sectionId}`);

    // Update URL without page reload 
    const url = new URL(window.location);
    url.searchParams.set('section', sectionId);
    window.history.pushState({}, '', url);

    // Shutdown external site if there is one
    const externalSite = document.getElementById('external-site');
    if (rightFrame.classList.contains('external')) {
        // Hide the external site container
        externalSite.style.display = 'none';
        // Clear any existing iframe content to prevent resource usage
        externalSite.replaceChildren();
        // Remove external mode flag
        rightFrame.classList.remove('external');
    }

    // If we're leaving settings, handle any rss feed changes
    if (currentSection === 'settings') {
        leaveSettings();
    }

    // If we're leaving news section, clean up observer and mark visible items as read
    if (currentSection === 'news' && sectionId !== 'news') {
        cleanupNewsObserver();
        stopNewsTimeUpdates();
        resumeNewsUpdates(); // Resume auto-refresh when leaving news section
    }

    // If we're leaving market section, stop updates
    if (currentSection === 'market' && sectionId !== 'market') {
        stopMarketUpdates();
    }

    // If switching to news section, set up observer and start time updates
    if (sectionId === 'news') {
        pauseNewsUpdates(); // Suppress auto-refresh while viewing news section
        // Set up the observer for visible news items and start time updates
        setTimeout(() => {
            setupNewsObserver();
            startNewsTimeUpdates();
        }, 100);
    }

    // If switching to market section, initialize market updates
    if (sectionId === 'market') {
        initMarketSection();
    }

    // If switching to about section, clear the notification dot and mark note as seen
    if (sectionId === 'about') {
        const aboutButton = document.getElementById('about-section');
        if (aboutButton) {
            aboutButton.classList.remove('has-notification');
            aboutButton.removeAttribute('data-count'); // Remove count attribute
        }
        
        // Mark the current note as seen by updating the last-note-hash-seen setting
        const noteElement = document.getElementById('note');
        if (noteElement) {
            const noteHash = noteElement.getAttribute('data-note-hash');
            if (noteHash) {
                saveSetting('last-note-hash-seen', noteHash);
            }
        }
    }

    // Debug section - initialize debug output if switching to debug section
    if (sectionId === 'debug') {
        const debugOutput = document.getElementById('debug-output');
        if (debugOutput && !debugOutput.textContent) {
            debugOutput.textContent = 'Debug mode active. Debug information will appear here.';
        }
    }

    // Satellite section
    if (sectionId === 'satellite') {
        // Load weather image when satellite section is shown
        const weatherImage = document.getElementById('weather-image');
        const regionUrls = SAT_URLS[currentSatRegion];
        // Load the first available image type for the region
        if (regionUrls.latest) {
            weatherImage.src = regionUrls.latest;
        } else if (regionUrls.latest_ir) {
            weatherImage.src = regionUrls.latest_ir;
        } else if (regionUrls.loop) {
            weatherImage.src = regionUrls.loop;
        }
    } else {
        // Remove weather img src to force reload when switching back
        const weatherImage = document.getElementById('weather-image');
        if (weatherImage) {
            weatherImage.src = '';
        }
    }

    // Update network info if the network section is visible
    if (sectionId === 'network') {
        if (!networkInfoUpdated) {
            updateNetworkInfo();
            networkInfoUpdated = true;
        }
        updatePingChart(true);  // with animation
    }

    // Update Wikipedia data if the landmarks section is visible
    if (sectionId === 'landmarks') {
        if (lat !== null && long !== null) {
            fetchLandmarkData(lat, long);
        } else {
            console.log('GPS not available for landmarks data, attempting IP-based location fallback...');
            
            // Try to get IP-based location as fallback
            getIPBasedLocation().then(ipLocation => {
                if (ipLocation && ipLocation.latitude && ipLocation.longitude) {
                    // Successfully got IP-based location, fetch landmark data
                    console.log('Using IP-based location for landmarks data');
                    
                    // Set flag to indicate we're using IP-based location
                    setUsingIPLocation(true);
                    
                    // Fetch landmark data with IP-based coordinates
                    fetchLandmarkData(ipLocation.latitude, ipLocation.longitude);
                } else {
                    // IP location lookup failed, show error message
                    console.log('IP-based location lookup failed for landmarks');
                    showLandmarksError('Location not available. Unable to retrieve nearby landmarks.');
                }
            }).catch(error => {
                console.error('Error in IP-based location fallback for landmarks: ', error);
                showLandmarksError('Error loading landmark data.');
            });
        }
    }

    // Handle weather section when GPS is not available
    if (sectionId === 'weather') {
        if (gpsPermissionDenied || gpsFailureCount >= MAX_GPS_RETRIES || lat === null || long === null) {
            console.log('GPS not available for weather data, attempting IP-based location fallback...');
            
            // Try to get IP-based location as fallback
            getIPBasedLocation().then(ipLocation => {
                if (ipLocation && ipLocation.latitude && ipLocation.longitude) {
                    // Successfully got IP-based location, fetch weather data
                    console.log('Using IP-based location for weather data');
                    
                    // Set flag to indicate we're using IP-based location
                    setUsingIPLocation(true);
                    
                    // Show forecast container
                    const forecastContainer = document.getElementById('prem-forecast-container');
                    if (forecastContainer) {
                        forecastContainer.style.display = '';
                    }
                    
                    // Hide GPS unavailable message if it exists
                    const gpsUnavailableMsg = document.getElementById('weather-gps-unavailable');
                    if (gpsUnavailableMsg) {
                        gpsUnavailableMsg.style.display = 'none';
                    }
                    
                    // Hide the IP location message (no longer needed - will show in station info)
                    const ipLocationMsg = document.getElementById('weather-ip-location');
                    if (ipLocationMsg) {
                        ipLocationMsg.style.display = 'none';
                    }
                    
                    // Fetch weather data with IP-based coordinates
                    fetchPremiumWeatherData(ipLocation.latitude, ipLocation.longitude);
                } else {
                    // IP location lookup failed, show error message
                    console.log('IP-based location lookup failed');
                    const forecastContainer = document.getElementById('prem-forecast-container');
                    if (forecastContainer) {
                        forecastContainer.style.display = 'none';
                    }
                    
                    // Hide IP location message if it exists
                    const ipLocationMsg = document.getElementById('weather-ip-location');
                    if (ipLocationMsg) {
                        ipLocationMsg.style.display = 'none';
                    }
                    
                    // Create or show GPS unavailable message
                    let gpsUnavailableMsg = document.getElementById('weather-gps-unavailable');
                    if (!gpsUnavailableMsg) {
                        gpsUnavailableMsg = document.createElement('div');
                        gpsUnavailableMsg.id = 'weather-gps-unavailable';
                        gpsUnavailableMsg.style.textAlign = 'center';
                        gpsUnavailableMsg.style.padding = '2rem';
                        gpsUnavailableMsg.style.color = 'var(--text-muted)';
                        
                        const p = document.createElement('p');
                        const em = document.createElement('em');
                        em.textContent = 'Location not available. Unable to retrieve weather forecast.';
                        p.appendChild(em);
                        gpsUnavailableMsg.appendChild(p);
                        
                        // Insert after the weather section header
                        const weatherSection = document.getElementById('weather');
                        const firstH2 = weatherSection.querySelector('h2');
                        if (firstH2 && firstH2.nextSibling) {
                            weatherSection.insertBefore(gpsUnavailableMsg, firstH2.nextSibling);
                        } else {
                            weatherSection.appendChild(gpsUnavailableMsg);
                        }
                    }
                    gpsUnavailableMsg.style.display = 'block';
                }
            }).catch(error => {
                console.error('Error in IP-based location fallback: ', error);
            });
        } else {  // GPS is available, show normal forecast container
            const forecastContainer = document.getElementById('prem-forecast-container');
            if (forecastContainer) {
                forecastContainer.style.display = '';
            }
            
            // Hide GPS unavailable message if it exists
            const gpsUnavailableMsg = document.getElementById('weather-gps-unavailable');
            if (gpsUnavailableMsg) {
                gpsUnavailableMsg.style.display = 'none';
            }
            
            // Hide IP location message if it exists
            const ipLocationMsg = document.getElementById('weather-ip-location');
            if (ipLocationMsg) {
                ipLocationMsg.style.display = 'none';
            }
        }
    }

    // Hide all sections first
    const sections = document.querySelectorAll('.section');
    sections.forEach(section => {
        section.style.display = 'none';
    });

    // Make sure external-site is hidden
    externalSite.style.display = 'none';

    // Show the selected section
    const section = document.getElementById(sectionId);
    if (section) {
        section.style.display = 'block';
        if (sectionId === 'weather') {
            requestAnimationFrame(ensurePrecipitationGraphWidth);
        }
    }

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

    // Update the current section variable
    currentSection = sectionId;
    
    // Reset scroll position to top
    rightFrame.scrollTop = 0;
    
    // Update scroll indicators after a small delay to let content render
    setTimeout(updateScrollIndicators, 100);
};

// Update link click event listener
document.addEventListener('click', function (e) {
    if (e.target.tagName === 'A' && !e.target.closest('.section-buttons')) {
        e.preventDefault();
        const inFrame = e.target.hasAttribute('data-frame');
        let url = e.target.href;
        
        // For FAQ links, append dark mode parameter if dark mode is active
        if (url.includes('faq.html')) {
            const isDarkMode = document.body.classList.contains('dark-mode');
            const separator = url.includes('?') ? '&' : '?';
            url = `${url}${separator}dark=${isDarkMode}`;
        }
        
        loadExternalUrl(url, inFrame);
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
        stopStockUpdates();
        stopDarkModeChecks();
    } else {
        startGPSUpdates();
        // Only resume news updates if not currently viewing the news section
        if (currentSection !== 'news') {
            resumeNewsUpdates();
        }
        resumePingTest();
        startStockUpdates();
        // Check dark mode when app returns to foreground
        autoDarkMode();
        startDarkModeChecks();
    }
});

// Event listeners and initialization after DOM content is loaded
document.addEventListener('DOMContentLoaded', async function () {
    // Log that the DOM is fully loaded
    console.log('DOM fully loaded and parsed...');

    // Update page title and heading with current domain
    const domain = window.location.hostname;
    document.title = domain;
    const siteTitle = document.getElementById('site-title');
    if (siteTitle) {
        siteTitle.textContent = domain;
    }

    // Attempt login from URL parameter or cookie
    await attemptLogin();
    
    // Show debug button if debug mode is active
    if (debugMode) {
        const debugButton = document.getElementById('debug-section');
        if (debugButton) {
            debugButton.classList.remove('hidden');
        }
    }
    
    // Initialize news storage system (create user directory if needed)
    await initializeNewsStorage();

    // Enable live news updates to allow RSS setting changes to trigger immediate updates
    enableLiveNewsUpdates();
    
    // Check for NOTE file and display if present
    updateServerNote();

    // Show test notification if note test mode is active
    if (isTestMode('note')) {
        setTimeout(() => {
            showTestNotification();
        }, 1000); // Show after 1 second to ensure page is fully loaded
    }

    // Initialize forecast day elements
    generateForecastDayElements(5);

    // Initialize radar display
    initializeRadar();

    // Start location services
    startGPSUpdates();

    // Begin network sensing
    startPingTest();

    // Start periodic dark mode checks
    startDarkModeChecks();

    // Get version from php/vers.php asyncly
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
    
    // Add scroll event listeners for control container scaling
    document.getElementById('rightFrame').addEventListener('scroll', handleScrollScale);
    window.addEventListener('scroll', handleScrollScale);

    // Apply initial scaling on page load
    handleScrollScale();

    // Update scroll indicators when window is resized
    window.addEventListener('resize', () => {
        updateScrollIndicators();
        updateMobileSectionVisibility();
    });

    // Update mobile section visibility on page load
    updateMobileSectionVisibility();

    // Scroll-to-top button
    const scrollTopBtn = document.getElementById('scroll-to-top');
    if (scrollTopBtn) {
        scrollTopBtn.addEventListener('click', () => {
            const isMobile = window.matchMedia("only screen and (max-width: 900px)").matches;
            if (isMobile) {
                window.scrollTo({ top: 0, behavior: 'smooth' });
            } else {
                document.getElementById('rightFrame').scrollTo({ top: 0, behavior: 'smooth' });
            }
        });
    }

    // Moved in from wx.js...
    var premCloseBtn = document.getElementById('prem-forecast-popup-close');
    if (premCloseBtn) {
        premCloseBtn.onclick = window.closePremiumPrecipPopup;
    }
    const dimOverlay = document.getElementById('forecast-dim-overlay');
    if (dimOverlay) {
        dimOverlay.addEventListener('click', (event) => {
            event.stopPropagation();
            window.closePremiumPrecipPopup();
        });
    }

    // Close the premium weather popup when clicking outside of it
    document.addEventListener('click', (event) => {
        const premPopup = document.querySelector('#weather .forecast-popup');
        if (!premPopup || !premPopup.classList.contains('show')) {
            return;
        }

        // Keep the popup open when clicking inside it
        if (premPopup.contains(event.target)) {
            return;
        }

        window.closePremiumPrecipPopup();
    });

    // Show the initial section from URL parameter
    const urlParams = new URLSearchParams(window.location.search);
    const initialSection = urlParams.get('section') || DEFAULT_SECTION;
    showSection(initialSection);
});
