// Imports
import { srcUpdate, testMode, updateTimeZone, GEONAMES_USERNAME } from './common.js';
import { PositionSimulator } from './location.js';
import { attemptLogin, leaveSettings, settings, isDriving, setDrivingState, enableLiveNewsUpdates } from './settings.js';
import { fetchPremiumWeatherData, fetchCityData, SAT_URLS, forecastDataPrem, currentRainAlert } from './wx.js';
import { updateNetworkInfo, updatePingChart, startPingTest } from './net.js';
import { setupNewsObserver, startNewsTimeUpdates, initializeNewsStorage } from './news.js';
import { startStockUpdates, stopStockUpdates } from './stock.js';

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
let networkInfoUpdated = false;                     // Track if network info has been updated
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
    `${baseUrl}?lat=${lat}&lng=${long}&radius=15&maxRows=150&username=${GEONAMES_USERNAME}`;
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
        document.getElementById('headwind-arrow').textContent = (headWind > 0 ? '▼' : '▲'); // down/up filled triangles
        // Change the label to TAILWIND when headWind is negative and use appropriate units
        if (!settings || settings["imperial-units"]) {
            document.getElementById('headwind-label').innerText = (headWind < 0) ? "TAILWIND (MPH)" : "HEADWIND (MPH)";
        } else {
            document.getElementById('headwind-label').innerText = (headWind < 0) ? "TAILWIND (M/S)" : "HEADWIND (M/S)";
        }
    } else {
        document.getElementById('headwind').innerText = '--';
        document.getElementById('headwind-arrow').textContent = '';
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
        document.getElementById('crosswind-arrow').textContent = (crossWind >= 0 ? '▶' : '◀'); // right/left triangles
    } else {
        document.getElementById('crosswind').innerText = '--';
        document.getElementById('crosswind-arrow').textContent = '';
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
    lat = position.coords.latitude;
    long = position.coords.longitude;
    alt = position.coords.altitude;
    acc = position.coords.accuracy;
    speed = position.coords.speed / 0.44704; // Convert m/s to mph
    if (position.coords.heading) {
        lastKnownHeading = position.coords.heading;
    }

    // Update GPS status indicator based on GPS accuracy
    const gpsStatusElement = document.getElementById('gps-status');
    if (gpsStatusElement) {
        if (lat === null || long === null) {
            // Use CSS variable for unavailable GPS
            gpsStatusElement.style.color = 'var(--status-unavailable)';
            gpsStatusElement.title = 'GPS Unavailable';
            gpsStatusElement.classList.remove('hidden'); // Show indicator when GPS is unavailable
        } else {
            gpsStatusElement.classList.remove('hidden');
            
            // Interpolate between yellow and green based on accuracy
            const maxAccuracy = 50;  // Yellow threshold
            const minAccuracy = 10;   // Green threshold

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

    // Update wind display if nav section is visible
    const navigationSection = document.getElementById("navigation");
    if (navigationSection.style.display === "block") {
        // Update heading displays
        if (lastKnownHeading) {
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

        document.getElementById('accuracy').innerText = acc ? Math.round(acc) + ' m' : '--';
    }

    // Handle whether or not we're driving
    if (ENABLE_SPEED_DISABLE && speed > SPEED_DISABLE_THRESHOLD) {
        if (!isDriving) {
            startedDriving();
        }
        setDrivingState(true);
    } else {
        if (isDriving) {
            stoppedDriving();
        }
        setDrivingState(false);
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
    if (!testMode) {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(handlePositionUpdate);
        } else {
            console.log('Geolocation is not supported by this browser.');
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

// Check for NOTE file and display if present (now via PHP endpoint to avoid 404s)
function updateServerNote() {
    fetch('get_note.php', { cache: 'no-store' })
        .then(response => {
            if (!response.ok) throw new Error('Network response not ok');
            return response.json();
        })
        .then(data => {
            const content = (data && typeof data.note === 'string') ? data.note.trim() : '';
            const mtime = (data && typeof data.mtime === 'number') ? data.mtime : null;
            const noteElement = document.getElementById('note');
            const announcementSection = document.getElementById('announcement');
            const aboutButton = document.getElementById('about-section');

            if (content && noteElement && announcementSection) {
                // Clear existing content
                noteElement.replaceChildren();

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

                if (aboutButton) {
                    aboutButton.classList.add('has-notification');
                    aboutButton.setAttribute('data-count', '1');
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

// Show git version from vers.php
function updateVersion() {
    const versionElement = document.getElementById('version');
    if (versionElement) {
        fetch('vers.php')
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

    // If switching to news section, set up observer and start time updates
    if (sectionId === 'news') {
        // Set up the observer for visible news items and start time updates
        setTimeout(() => {
            setupNewsObserver();
            startNewsTimeUpdates();
        }, 100);
    }

    // If switching to about section, clear the notification dot
    if (sectionId === 'about') {
        const aboutButton = document.getElementById('about-section');
        if (aboutButton) {
            aboutButton.classList.remove('has-notification');
            aboutButton.removeAttribute('data-count'); // Remove count attribute
        }
    }

    // Satellite section
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
            console.log('Location not available for Wikipedia data.');
            document.getElementById('landmarks-loading').style.display = 'none';
            const items = document.getElementById('landmark-items');
            items.style.display = 'block';
            items.replaceChildren();
            const p = document.createElement('p');
            const em = document.createElement('em');
            em.textContent = 'Location data not available. Please enable GPS.';
            p.appendChild(em);
            items.appendChild(p);
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
        stopStockUpdates();
    } else {
        startGPSUpdates();
        resumeNewsUpdates();
        resumePingTest();
        startStockUpdates();
    }
});

document.addEventListener('DOMContentLoaded', function () {
    var premCloseBtn = document.getElementById('prem-forecast-popup-close');
    if (premCloseBtn) {
        premCloseBtn.onclick = window.closePremiumPrecipPopup;
    }
});

// Event listeners and initialization after DOM content is loaded
document.addEventListener('DOMContentLoaded', async function () {
    // Log that the DOM is fully loaded
    console.log('DOM fully loaded and parsed...');

    // Attempt login from URL parameter or cookie
    await attemptLogin();
    
    // Initialize news storage system (create user directory if needed)
    await initializeNewsStorage();

    // Enable live news updates to allow RSS setting changes to trigger immediate updates
    enableLiveNewsUpdates();
    
    // Check for NOTE file and display if present
    updateServerNote();

    // Initialize radar display
    initializeRadar();

    // Start location services
    startGPSUpdates();

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
    
    // Add scroll event listeners for control container scaling
    document.getElementById('rightFrame').addEventListener('scroll', handleScrollScale);
    window.addEventListener('scroll', handleScrollScale);

    // Apply initial scaling on page load
    handleScrollScale();

    // Update scroll indicators when window is resized
    window.addEventListener('resize', updateScrollIndicators);

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

    // Show the initial section from URL parameter
    const urlParams = new URLSearchParams(window.location.search);
    const initialSection = urlParams.get('section') || DEFAULT_SECTION;
    showSection(initialSection);

    // Moved in from wx.js...
    var premCloseBtn = document.getElementById('prem-forecast-popup-close');
    if (premCloseBtn) {
        premCloseBtn.onclick = window.closePremiumPrecipPopup;
    }
});
