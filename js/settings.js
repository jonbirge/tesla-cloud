// Imports
import { updateNews, setShareButtonsVisibility, initializeNewsStorage } from './news.js';
import { updateNetChartAxisColors } from './net.js';
import { updatePremiumWeatherDisplay } from './wx.js';
import { startStockUpdates, stopStockUpdates } from './stock.js';
import { forecastDataPrem, lastLat, lastLong, updateRainChartAxisColors } from './wx.js';

// Night mode offset in minutes - enter dark mode this many minutes before sunset
// and exit dark mode this many minutes after sunrise to match Tesla's car behavior
const NIGHT_MODE_OFFSET_MINUTES = 8;

// Global variables
let isDriving = false;          // The vehicle is not parked
let isLoggedIn = false;         // User is logged in
let currentUser = null;         // Will be NULL if not logged in OR if using auto-generated ID
let hashedUser = null;          // The hashed version of the user ID
let rssIsDirty = false;         // Flag to indicate if RSS settings have changed
let rssDrop = false;            // Flag to indicate if an RSS feed has been dropped
let unitIsDirty = false;        // Flag to indicate if unit/time settings have changed
let settings = {};              // Initialize settings object
let live_news_updates = false;  // Flag to control whether news updates should be triggered immediately
let lastKnownUpdate = null;     // Timestamp of last known settings update
let settingsPollingInterval = null; // Interval ID for settings polling
let isUpdatingSettings = false; // Flag to prevent concurrent updates

// Export settings object so it's accessible to other modules
export { settings, currentUser, isLoggedIn, hashedUser, isDriving, live_news_updates };

// Default settings that will be used when no user is logged in
const defaultSettings = {
    // General settings
    "dark-mode": false,
    "auto-dark-mode": true,
    "24-hour-time": false,
    "imperial-units": true,
    "map-choice": 'waze',
    "show-wind-radar": false,
    "show-speed-indicators": true,
    "show-hourly-stripes": true,
    "sat-region": 'us',
    // Stocks
    "show-price-alt": false,
    "show-stock-indicator": true,
    "subscribed-stocks": ["TSLA"],
    "subscribed-indexes": ["SPY", "DIA"],
    // News settings
    "show-news-count": true,
    // News forwarding
    "news-forwarding": false,
    "news-forward-only": false,
    "forwarding-email": "",
    // News feed settings populated dynamically from news.json
};

// Function that sets driving state
export function setDrivingState(state) {
    isDriving = state;
}

// Settings section is being left
export function leaveSettings() {
    // Handle RSS settings if any were changed but not automatically updated
    if (rssIsDirty) {
        console.log('RSS settings are dirty, updating news feed now');
        import('./news.js').then(newsModule => {
            if (typeof newsModule.updateNews === 'function') {
                newsModule.updateNews(rssDrop);
            }
        });
        rssIsDirty = false; // Reset the dirty flag
        rssDrop = false;    // Reset the drop flag
    }

    if (unitIsDirty) {
        console.log('Unit/time settings are dirty, updating weather display.')
        updatePremiumWeatherDisplay();
        unitIsDirty = false; // Reset the dirty flag
    }
}

// Check for auto dark mode setting and implement it if enabled
export function autoDarkMode(lat, long) {
    // If lat/long not provided, use last known from wx.js
    if (lat == null || long == null) {
        if (lastLat != null && lastLong != null) {
            lat = lastLat;
            long = lastLong;
        } else {
            console.log('autoDarkMode: No coordinates available.');
            return;
        }
    }

    // Prefer daily[0] sunrise/sunset; fall back to current.* if available
    const sunriseSec = forecastDataPrem?.daily?.[0]?.sunrise ?? forecastDataPrem?.current?.sunrise;
    const sunsetSec  = forecastDataPrem?.daily?.[0]?.sunset  ?? forecastDataPrem?.current?.sunset;

    if (!sunriseSec || !sunsetSec) {
        console.log('Auto dark mode: No sunrise/sunset data available.');
        return;
    }

    if (settings && settings['auto-dark-mode']) {
        const now = Date.now();
        const sunriseTime = sunriseSec * 1000;
        const sunsetTime = sunsetSec * 1000;

        // Apply offset: enter dark mode before sunset, exit after sunrise
        const offsetMs = NIGHT_MODE_OFFSET_MINUTES * 60 * 1000;
        const adjustedSunsetTime = sunsetTime - offsetMs;  // Enter dark mode early
        const adjustedSunriseTime = sunriseTime + offsetMs; // Exit dark mode late

        const shouldBeDark = (now >= adjustedSunsetTime || now < adjustedSunriseTime);

        // Only update if different to avoid redundant work
        if (shouldBeDark !== !!settings['dark-mode']) {
            console.log(shouldBeDark ? 'Applying dark mode based on sunset...' : 'Applying light mode based on sunrise...');
            updateSetting('dark-mode', shouldBeDark);
        }
    } else {
        console.log('Auto dark mode disabled or coordinates not available.');
    }
}

// Function to attempt login
export async function attemptLogin() {
    const urlParams = new URLSearchParams(window.location.search);
    let userId = urlParams.get('user');  // deprecated, but keep for now

    // Check for user-set ID in cookies if not found in URL
    if (!userId) {
        userId = getCookie('userid');
    }

    // Get final hashedUserID either from named user or auto-generated user
    if (userId) {  // We have a named user
        if (await validateUserId(userId)) {
            console.log('Logged in named user ID: ', userId);
            await fetchSettings();
        }
    } else {  // Fall back to an auto-generated one
        const autoGeneratedId = getCookie('auto-userid');

        if (autoGeneratedId && await validateAutoUserId(autoGeneratedId)) {
            console.log('Logged in auto-generated ID: ', autoGeneratedId);
            await fetchSettings();
        } else {
            console.log('No user IDs found, creating new auto-generated user...');
            await setDefaultSettings();
            const newAutoUser = await autoCreateUser(); // Create a new user and log them in
            if (await validateAutoUserId(newAutoUser)) {
                for (const [key, value] of Object.entries(settings)) {
                    await saveSetting(key, value);
                }
                await fetchSettings(); // Fetch settings for the new user
            }
        }
    }

    // Log final state of currentUser, hashedUser, and isLoggedIn
    console.log('currentUser:', currentUser);
    console.log('hashedUser:', hashedUser);
    console.log('isLoggedIn:', isLoggedIn);

    // Start polling for settings updates if logged in
    if (isLoggedIn && hashedUser) {
        startSettingsPolling(5000); // Poll every 5 seconds
    }

    // Initialize map frame option
    updateMapFrame();
}

// Function to change a setting (updating both local cache and server)
export async function saveSetting(key, value) {
    console.log(`Setting "${key}" updated to ${value} (local)`);
    
    // Handle local settings
    settings[key] = value;

    // Update the interface
    updateSetting(key, value);

    // Update server if logged in
    if (isLoggedIn && hashedUser) {
        try {
            // Update the local settings cache with boolean value
            settings[key] = value;

            // Update the server with the boolean value using the RESTful API
            const response = await fetch(`php/settings.php/${encodeURIComponent(hashedUser)}/${encodeURIComponent(key)}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    value: value
                })
            });

            if (response.ok) {
                console.log(`Setting "${key}" updated to ${value} (server)`);
                // Update our local timestamp after successfully saving
                await updateLastKnownTimestamp();
            } else {
                console.log(`Failed to update setting "${key}" on server`);
            }
        } catch (error) {
            console.log('Error toggling setting:', error);
        }
    }

    // Handle special case interactions
    // TODO: Is this still needed here or could it be moved to the updateSetting function?

    // If the setting is "dark-mode", turn off auto-dark-mode
    if (key === 'dark-mode') {
        saveSetting('auto-dark-mode', false);
        console.log('Auto dark mode disabled due to manual dark mode setting.');
    }
}

// Turn on dark mode
function turnOnDarkMode() {
    console.log('turnOnDarkMode() called');
    document.body.classList.add('dark-mode');
    // document.getElementById('darkModeToggle').checked = true;
    // saveSetting('dark-mode', true);
    updateDarkModeDependants();
}

// Turn off dark mode
function turnOffDarkMode() {
    console.log('turnOffDarkMode() called');
    document.body.classList.remove('dark-mode');
    // document.getElementById('darkModeToggle').checked = false;
    // saveSetting('dark-mode', false);
    updateDarkModeDependants();
}

// Load default settings from JSON files before applying them
async function loadDefaultSettings() {
    try {
        const response = await fetch('config/news.json');
        const feedData = await response.json();
        
        // Handle both old array format and new object format for backward compatibility
        if (Array.isArray(feedData)) {
            availableNewsSources = feedData;
        } else {
            availableNewsSources = feedData.feeds || [];
            availableNewsSections = feedData.sections || [];
        }
        
        updateDefaultNewsSettings();
    } catch (error) {
        console.error('Error loading news feeds data for defaults:', error);
    }
}

// Initialize settings with defaults
async function setDefaultSettings() {
    // Load defaults from JSON first
    await loadDefaultSettings();

    settings = { ...defaultSettings };
    initializeSettings();
    updateRadarVisibility();
    updateSpeedIndicatorVisibility();
    console.log('Settings initialized to defaults');
}

// Helper function to update things that depend on dark mode
function updateDarkModeDependants() {
    updateNetChartAxisColors();
    updateRainChartAxisColors();
}

// Helper function to show/hide radar display based on setting
function updateRadarVisibility() {
    const radar = document.getElementById('radar-container');
    if (radar) {
        radar.style.display = (settings["show-wind-radar"] === false) ? 'none' : '';
    }
}

// Helper function to show/hide speed indicators based on setting
function updateSpeedIndicatorVisibility() {
    const speedBox = document.querySelector('.stat-box:has(#speed)');
    const verticalRateBox = document.querySelector('.stat-box:has(#vertical-rate)');
    const navStats = document.querySelector('.nav-stats');

    const shouldShow = settings["show-speed-indicators"] !== false;

    if (speedBox) {
        speedBox.style.display = shouldShow ? '' : 'none';
    }
    if (verticalRateBox) {
        verticalRateBox.style.display = shouldShow ? '' : 'none';
    }
    // Toggle 3x2 layout when extra detail is enabled
    if (navStats) {
        navStats.classList.toggle('extra-detail', shouldShow);
    }
}

// Function to hash a user ID using SHA-256
async function hashUserId(userId) {
    // Use the SubtleCrypto API to create a SHA-256 hash
    const encoder = new TextEncoder();
    const data = encoder.encode(userId);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    
    // Convert the hash buffer to a hexadecimal string
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    // Return only the first 16 characters (64 bits) of the hash
    return hashHex.substring(0, 16);
}

// Internal helper function
async function validateHashedUserId(hashedId, userId = null)
{
    try {
        // Use HEAD request to check if the user exists
        const response = await fetch(`php/settings.php/${encodeURIComponent(hashedId)}`, {
            method: 'HEAD'
        });
        
        if (response.status === 404) {
            // User doesn't exist, create default settings
            const created = await createNewUser(userId, hashedId);
            if (!created) {
                return false;
            }
        } else if (!response.ok) {
            return false;
        }
        
        // User exists, set environment variables
        isLoggedIn = true;
        hashedUser = hashedId;
        currentUser = null;
        console.log('User validated on server: ', hashedId);
        return true;
    } catch (error) {
        isLoggedIn = false;
        hashedUser = null;
        currentUser = null;
        console.error('Error validating user: ', error);
        return false;
    }
}

// Function to validate auto-generated user ID
async function validateAutoUserId(autoUserId) {
    if (await validateHashedUserId(autoUserId)) {
        setCookie('auto-userid', autoUserId);
        updateLoginState();
        return true;
    } else {
        return false;
    }
}

// Function to validate user ID, creating a new user if it doesn't exist
async function validateUserId(userId) {
    // Check for minimum length (9 characters)
    if (userId.length < 9) {
        return false;
    }
    
    // Check for standard characters (letters, numbers, underscore, hyphen)
    const validFormat = /^[a-zA-Z0-9_-]+$/;
    if (!validFormat.test(userId)) {
        return false;
    }

    // Hash the user ID before sending to the server
    const hashedId = await hashUserId(userId);

    if (await validateHashedUserId(hashedId, userId)) {
        currentUser = userId;
        setCookie('userid', userId);
        updateLoginState();
        return true;
    } else {
        currentUser = null;
        return false;
    }
}

// Function to create a new named user, always called with initialized settings
async function createNewUser(userId, hashedId = null) {
    try {
        // If hashedId wasn't provided, generate it
        if (!hashedId) {
            hashedId = await hashUserId(userId);
        }
        
        // Create new user with current settings directly
        console.log('Creating new user with preserved settings:', userId);
        console.log('Current settings to preserve:', settings);
        
        const response = await fetch(`php/settings.php/${encodeURIComponent(hashedId)}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                preserveSettings: settings
            })
        });
        
        if (response.ok) {
            console.log('Created new user with preserved settings:', userId);
            return true;
        } else {
            console.log('Failed to create new user:', userId);
            return false;
        }
    } catch (error) {
        console.error('Error creating new user:', error);
        return false;
    }
}

// Function to generate an auto-generated user from the server and return the hash
async function autoCreateUser() {
    try {
        const response = await fetch('php/settings.php', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                preserveSettings: settings
            })
        });
        if (response.ok) {
            let data = await response.json();
            console.log('Auto-generated user ID with preserved settings:', data.userId);
            return data.userId;
        } else {
            console.log('Failed to fetch random user ID from server');
            return null;
        }
    } catch (error) {
        console.error('Error fetching random user ID:', error);
        return null;
    }
}

// Update login/logout button visibility based on state
function updateLoginState() {
    const logoutButton = document.getElementById('logout-button');

    if (currentUser) {
        logoutButton.textContent = `Logout ${currentUser}`;
    } else {
        logoutButton.textContent = 'Login';
    }
}

// Pull all settings for current valided user from REST server
// TODO: fetchSettings should return a boolean indicating success or failure
async function fetchSettings() {
    if (!hashedUser) {
        console.log('No hashed user ID available, cannot fetch settings.');
        return;
    }

    try {
        // Fetch settings using RESTful API
        console.log('Fetching settings for user: ', hashedUser);
        const response = await fetch(`php/settings.php/${encodeURIComponent(hashedUser)}`, {
            method: 'GET'
        });

        if (response.ok) {
            // Load settings
            settings = await response.json();
            console.log('Settings loaded: ', settings);

            // Clean up orphaned stock/index subscriptions
            await cleanupOrphanedSubscriptions();

            // Activate the settings section button
            document.getElementById('settings-section').classList.remove('hidden');

            // Initialize toggle states based on settings
            initializeSettings();
            
            // Fetch and store the last updated timestamp
            await updateLastKnownTimestamp();
        } else {
            console.error('Error fetching settings: ', response.statusText);
            // Initialize with defaults if settings fetch failed
            await setDefaultSettings();
        }
    } catch (error) {
        console.error('Error fetching settings: ', error);
        // Initialize with defaults if settings fetch failed
        await setDefaultSettings();
    }
}

// Function to get and update the last known update timestamp
async function updateLastKnownTimestamp() {
    if (!hashedUser) {
        return;
    }
    
    try {
        const response = await fetch(`php/settings.php/${encodeURIComponent(hashedUser)}/last-updated`, {
            method: 'GET'
        });
        
        if (response.ok) {
            const data = await response.json();
            lastKnownUpdate = data['last-updated'];
            console.log('Last known update timestamp:', lastKnownUpdate);
        }
    } catch (error) {
        console.error('Error fetching last updated timestamp:', error);
    }
}

// Function to check if settings have been updated on the server
async function checkForSettingsUpdates() {
    if (!hashedUser || !isLoggedIn || isUpdatingSettings) {
        return;
    }
    
    try {
        const response = await fetch(`php/settings.php/${encodeURIComponent(hashedUser)}/last-updated`, {
            method: 'GET'
        });
        
        if (response.ok) {
            const data = await response.json();
            const serverTimestamp = data['last-updated'];
            
            // Check if server timestamp is newer than our last known timestamp
            if (lastKnownUpdate && serverTimestamp && serverTimestamp !== lastKnownUpdate) {
                console.log('Settings updated on server, reloading...', {
                    old: lastKnownUpdate,
                    new: serverTimestamp
                });
                
                // Prevent concurrent updates
                isUpdatingSettings = true;
                
                // Reload settings
                await fetchSettings();
                
                isUpdatingSettings = false;
            }
        }
    } catch (error) {
        console.error('Error checking for settings updates:', error);
        isUpdatingSettings = false;
    }
}

// Function to start polling for settings updates
export function startSettingsPolling(intervalMs = 5000) {
    // Stop any existing polling
    stopSettingsPolling();
    
    if (isLoggedIn && hashedUser) {
        console.log(`Starting settings polling every ${intervalMs}ms`);
        settingsPollingInterval = setInterval(checkForSettingsUpdates, intervalMs);
    }
}

// Function to stop polling for settings updates
export function stopSettingsPolling() {
    if (settingsPollingInterval) {
        console.log('Stopping settings polling');
        clearInterval(settingsPollingInterval);
        settingsPollingInterval = null;
    }
}

// Function to clean up orphaned stock and index subscriptions
async function cleanupOrphanedSubscriptions() {
    // Ensure we have the latest stock and index data
    if (availableStocks.length === 0 && availableIndexes.length === 0) {
        await loadStockAndIndexData();
    }

    let settingsChanged = false;
    const migratedSymbols = [];

    // Get valid symbols from JSON files
    const validStockSymbols = availableStocks.map(stock => stock.Symbol);
    const validIndexSymbols = availableIndexes.map(index => index.TrackingETF);

    // Clean up subscribed stocks
    const subscribedStocks = settings['subscribed-stocks'] || [];
    const cleanedStocks = subscribedStocks.filter(symbol => validStockSymbols.includes(symbol));
    const removedStocks = subscribedStocks.filter(symbol => !validStockSymbols.includes(symbol));
    if (removedStocks.length > 0) {
        console.log('Removing orphaned stock subscriptions:', removedStocks);
        settings['subscribed-stocks'] = cleanedStocks;
        settingsChanged = true;
        if (removedStocks.some(symbol => symbol && symbol.toUpperCase() === 'BITC')) {
            migratedSymbols.push('BITC');
        }
    }

    // Clean up subscribed indexes
    const subscribedIndexes = settings['subscribed-indexes'] || [];
    const cleanedIndexes = subscribedIndexes.filter(symbol => validIndexSymbols.includes(symbol));
    const removedIndexes = subscribedIndexes.filter(symbol => !validIndexSymbols.includes(symbol));
    if (removedIndexes.length > 0) {
        console.log('Removing orphaned index subscriptions:', removedIndexes);
        settingsChanged = true;
    }

    let updatedIndexes = cleanedIndexes;
    migratedSymbols.forEach(symbol => {
        if (validIndexSymbols.includes(symbol) && !updatedIndexes.includes(symbol)) {
            console.log(`Migrating ${symbol} subscription from stocks to indexes`);
            updatedIndexes = [...updatedIndexes, symbol];
            settingsChanged = true;
        }
    });

    settings['subscribed-indexes'] = updatedIndexes;

    // Save cleaned settings back to server if changes were made
    if (settingsChanged && isLoggedIn && hashedUser) {
        console.log('Saving cleaned subscription settings to server');
        try {
            await saveSetting('subscribed-stocks', settings['subscribed-stocks']);
            await saveSetting('subscribed-indexes', settings['subscribed-indexes']);
        } catch (error) {
            console.error('Error saving cleaned subscription settings:', error);
        }
    }
}

// Load available stocks and indexes for settings generation
let availableStocks = [];
let availableIndexes = [];

// Load available news feeds for settings generation
let availableNewsSources = [];
let availableNewsSections = [];

// Load JSON data for stocks and indexes
async function loadStockAndIndexData() {
    try {
        const [stocksResponse, indexesResponse] = await Promise.all([
            fetch('config/stocks.json'),
            fetch('config/indexes.json')
        ]);
        
        availableStocks = await stocksResponse.json();
        availableIndexes = await indexesResponse.json();
        
        // Generate settings UI after data is loaded
        generateStockIndexSettings();
    } catch (error) {
        console.error('Error loading stock/index data:', error);
    }
}

// Load JSON data for news feeds
async function loadNewsSourcesData() {
    try {
    const response = await fetch('config/news.json');
        const feedData = await response.json();
        
        // Handle both old array format and new object format for backward compatibility
        if (Array.isArray(feedData)) {
            availableNewsSources = feedData;
        } else {
            availableNewsSources = feedData.feeds || [];
            availableNewsSections = feedData.sections || [];
        }
        
        // Generate sections first, then settings UI after data is loaded
        generateNewsSections();
        generateNewsSourceSettings();
        
        // Update default settings based on JSON
        updateDefaultNewsSettings();
    } catch (error) {
        console.error('Error loading news feeds data:', error);
    }
}

// Update default settings based on news feeds JSON
function updateDefaultNewsSettings() {
    availableNewsSources.forEach(source => {
        const key = `rss-${source.id}`;
        if (!(key in defaultSettings)) {
            defaultSettings[key] = source.defaultEnabled || false;
        }
        // Also update current settings if they exist and don't have this key
        if (settings && !(key in settings)) {
            settings[key] = source.defaultEnabled || false;
        }
    });
}

// Function to generate stock and index settings dynamically
function generateStockIndexSettings() {
    const indexContainer = document.querySelector('#stock-index-settings');
    const stockContainer = document.querySelector('#stock-settings');
    
    if (!indexContainer || !stockContainer) return;
    
    indexContainer.replaceChildren();
    stockContainer.replaceChildren();

    // Generate index checkboxes (use Description for full name, fallback to IndexName)
    availableIndexes.forEach(index => {
        const label = index.Description || index.IndexName || index.TrackingETF;
        const div = createToggleItem('index', index.TrackingETF, label, index.icon);
        indexContainer.appendChild(div);
    });

    // Generate stock checkboxes
    availableStocks.forEach(stock => {
        const div = createToggleItem('stock', stock.Symbol, stock.StockName, stock.icon);
        stockContainer.appendChild(div);
    });

    // Update UI based on current subscriptions
    updateStockIndexUI();
}

function createToggleItem(type, symbol, labelText, iconUrl) {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'settings-toggle-item news-toggle-item';
    itemDiv.dataset.setting = `${type}-${symbol}`;
    itemDiv.addEventListener('click', function() {
        const input = this.querySelector('input');
        if (input) input.click();
    });

    // Create icon element
    const iconConfig = resolveToggleIcon(iconUrl);
    const img = document.createElement('img');
    img.src = iconConfig.src;
    img.dataset.usesFaviconService = iconConfig.usesFavicon ? 'true' : 'false';
    img.className = 'news-source-favicon'; // Reuse existing CSS class
    img.onerror = function () { 
        this.onerror = null;
        this.src = 'assets/stock-default.svg';
        if (this.dataset.usesFaviconService === 'true' && !window.matchMedia('(max-width: 900px)').matches) {
            this.style.display = 'none';
        } else {
            this.style.removeProperty('display');
        }
    };
    itemDiv.appendChild(img);

    const label = document.createElement('label');
    label.textContent = labelText;
    itemDiv.appendChild(label);

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.addEventListener('change', function() {
        toggleStockIndexSetting(this, type, symbol);
    });
    itemDiv.appendChild(input);

    const span = document.createElement('span');
    span.className = 'settings-toggle-slider';
    itemDiv.appendChild(span);

    return itemDiv;
}

function resolveToggleIcon(iconUrl) {
    if (!iconUrl || typeof iconUrl !== 'string') {
        return { src: 'assets/stock-default.svg', usesFavicon: false };
    }

    const trimmed = iconUrl.trim();
    if (trimmed === '') {
        return { src: 'assets/stock-default.svg', usesFavicon: false };
    }

    const lower = trimmed.toLowerCase();
    const isLocalAsset = trimmed.startsWith('assets/') || trimmed.startsWith('./assets/') || trimmed.startsWith('/assets/');
    if (isLocalAsset) {
        return { src: trimmed, usesFavicon: false };
    }

    if (lower.startsWith('http://') || lower.startsWith('https://')) {
        return { src: trimmed, usesFavicon: false };
    }

    return {
        src: `https://www.google.com/s2/favicons?domain=${trimmed}&sz=24`,
        usesFavicon: true
    };
}

// Function to handle stock/index subscription toggles
window.toggleStockIndexSetting = function(element, type, symbol) {
    const isChecked = element.checked;
    const settingKey = type === 'stock' ? 'subscribed-stocks' : 'subscribed-indexes';
    const currentList = settings[settingKey] || [];
    
    let newList;
    if (isChecked) {
        // Add to subscription list if not already present
        newList = currentList.includes(symbol) ? currentList : [...currentList, symbol];
    } else {
        // Remove from subscription list
        newList = currentList.filter(item => item !== symbol);
    }
    
    saveSetting(settingKey, newList);
}

// Function to update stock/index UI based on current subscriptions
function updateStockIndexUI() {
    const subscribedStocks = settings['subscribed-stocks'] || [];
    const subscribedIndexes = settings['subscribed-indexes'] || [];
    
    // Update stock checkboxes
    availableStocks.forEach(stock => {
        const checkbox = document.querySelector(`[data-setting="stock-${stock.Symbol}"] input`);
        if (checkbox) {
            checkbox.checked = subscribedStocks.includes(stock.Symbol);
        }
    });
    
    // Update index checkboxes
    availableIndexes.forEach(index => {
        const checkbox = document.querySelector(`[data-setting="index-${index.TrackingETF}"] input`);
        if (checkbox) {
            checkbox.checked = subscribedIndexes.includes(index.TrackingETF);
        }
    });
}

// Function to generate news sections dynamically
function generateNewsSections() {
    // Find the News Feeds h2 element
    let newsFeedsH2 = null;
    const h2Elements = document.querySelectorAll('h2');
    for (const h2 of h2Elements) {
        if (h2.textContent.trim() === 'News Feeds') {
            newsFeedsH2 = h2;
            break;
        }
    }
    
    if (!newsFeedsH2) {
        return;
    }
    
    // Remove existing hardcoded sections (h3 and div elements that follow)
    let nextElement = newsFeedsH2.nextElementSibling;
    while (nextElement && (nextElement.tagName === 'H3' || 
           (nextElement.tagName === 'DIV' && nextElement.id && nextElement.id.includes('news-') && nextElement.id.includes('-settings')))) {
        const elementToRemove = nextElement;
        nextElement = nextElement.nextElementSibling;
        elementToRemove.remove();
    }
    
    // Sort sections by priority (lower numbers first)
    const sortedSections = [...availableNewsSections].sort((a, b) => {
        const priorityA = a.priority || 999; // Default to high number if no priority
        const priorityB = b.priority || 999;
        return priorityA - priorityB;
    });
    
    // Create all section elements first
    const sectionElements = [];
    sortedSections.forEach(section => {
        // Create h3 element
        const h3 = document.createElement('h3');
        h3.textContent = section.title;
        
        // Create div container
        const div = document.createElement('div');
        div.id = section.containerId;
        div.className = 'settings-controls news-source-grid';
        
        // Add comment inside div
        div.appendChild(document.createComment(` ${section.title} news source settings dynamically generated here `));
        
        sectionElements.push(h3, div);
    });
    
    // Insert all elements in order after the News Feeds h2
    let insertAfter = newsFeedsH2;
    sectionElements.forEach(element => {
        insertAfter.insertAdjacentElement('afterend', element);
        insertAfter = element;
    });
}

// Function to generate news source settings dynamically
function generateNewsSourceSettings() {
    const sectionContainers = {};
    const sectionsToUse = availableNewsSections.length ? availableNewsSections : [
        { id: 'general', containerId: 'news-general-settings' },
        { id: 'business', containerId: 'news-business-settings' },
        { id: 'technology', containerId: 'news-technology-settings' },
        { id: 'defense', containerId: 'news-defense-settings' },
        { id: 'tesla', containerId: 'news-tesla-settings' }
    ];

    // Build a map of section id -> DOM container for easy lookup and clearing
    sectionsToUse.forEach(section => {
        if (!section.containerId) {
            return;
        }
        const container = document.querySelector(`#${section.containerId}`);
        if (container) {
            container.replaceChildren();
            sectionContainers[section.id] = container;
        }
    });

    if (!Object.keys(sectionContainers).length) {
        return;
    }

    // Fallback to general container if available for unknown categories
    const defaultContainer = sectionContainers.general || Object.values(sectionContainers)[0];

    // Generate news source checkboxes by category
    availableNewsSources.forEach(source => {
        const container = sectionContainers[source.category] || defaultContainer;
        if (!container) {
            return;
        }
        const div = createNewsToggleItem(source);
        container.appendChild(div);
    });

    // Update UI based on current settings
    updateNewsSourceUI();
}

function createNewsToggleItem(source) {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'settings-toggle-item news-toggle-item';
    itemDiv.dataset.setting = `rss-${source.id}`;
    itemDiv.addEventListener('click', function() {
        const input = this.querySelector('input');
        if (input) input.click();
    });

    // Extract domain for favicon either from the source.icon or from source.url
    let faviconUrl = '';
    if (source.icon && typeof source.icon === 'string' && source.icon.trim() !== '') {
        // Use the domain from the icon key
        faviconUrl = `https://www.google.com/s2/favicons?domain=${source.icon}&sz=24`;
    } else {
        try {
            const url = new URL(source.url);
            faviconUrl = `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=24`;
        } catch (e) {
            console.error('Error parsing URL for favicon:', e);
        }
    }

    // Create favicon image element
    const img = document.createElement('img');
    img.src = faviconUrl;
    img.className = 'news-source-favicon';
    img.onerror = function () { 
        // Only hide on error if not on mobile (CSS will handle mobile suppression)
        if (!window.matchMedia('(max-width: 900px)').matches) {
            this.style.display = 'none'; 
        }
    };
    itemDiv.appendChild(img);

    const label = document.createElement('label');
    label.textContent = source.name;
    itemDiv.appendChild(label);

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.addEventListener('change', function() {
        toggleSettingFrom(this);
    });
    itemDiv.appendChild(input);

    const span = document.createElement('span');
    span.className = 'settings-toggle-slider';
    itemDiv.appendChild(span);

    return itemDiv;
}

// Function to update news source UI based on current settings
function updateNewsSourceUI() {
    availableNewsSources.forEach(source => {
        const settingKey = `rss-${source.id}`;
        const checkbox = document.querySelector(`[data-setting="${settingKey}"] input`);
        if (checkbox) {
            checkbox.checked = settings[settingKey] || false;
        }
    });
}

// Update UI state based on a specific setting
function updateSetting(key, value) {
    const settingItems = document.querySelectorAll(`.settings-toggle-item[data-setting="${key}"]`);
    
    // console.log(`Updating state for "${key}" to ${value}`);

    // Special compatibility cases
    if (key === 'imperial-units') {
        let unitsValue;
        if (value === true) {
            value = 'english';
        } else {
            value = 'metric';
        }
    }
    
    // Update UI elements based on the setting type
    if (settingItems && settingItems.length > 0) {
        settingItems.forEach(item => {
            // Handle checkbox toggle
            const toggle = item.querySelector('input[type="checkbox"]');
            if (toggle) {
                toggle.checked = value === true;
            }

            // Handle option-based toggles
            if (item.classList.contains('option-switch-container')) {
                const buttons = item.querySelectorAll('.option-button');
                buttons.forEach(btn => {
                    btn.classList.toggle('active', btn.dataset.value === value);
                });
            }

            // Handle text input
            if (item.classList.contains('settings-text-item')) {
                const textInput = item.querySelector('input[type="text"]');
                if (textInput) {
                    textInput.value = value || '';
                }
            }
        });
    }

    // Handle settings effects
    switch (key) {
        case 'subscribed-stocks':
        case 'subscribed-indexes':
            // Update stock/index UI and restart updates
            updateStockIndexUI();
            import('./stock.js').then(stockModule => {
                if (typeof stockModule.updateStockIndicatorVisibility === 'function') {
                    stockModule.updateStockIndicatorVisibility();
                }
                // Start stock updates to ensure timer is running
                if (typeof stockModule.startStockUpdates === 'function') {
                    stockModule.startStockUpdates();
                }
                // Always fetch fresh data immediately when subscriptions change
                if (typeof stockModule.fetchStockData === 'function') {
                    stockModule.fetchStockData();
                }
            });
            break;

        case 'imperial-units':
        case '24-hour-time':
            unitIsDirty = true;
            // console.log(`Unit/time setting "${key}" changed to ${value} (dirty: ${unitIsDirty})`);
            break;
            
        case 'auto-dark-mode':
            if (value) {
                autoDarkMode();
            }
            break;
            
        case 'map-choice':
            updateMapFrame();
            break;
            
        case 'news-forwarding':
            setShareButtonsVisibility();
            setControlEnable('forwarding-email', value);
            setControlEnable('news-forward-only', value);
            break;
            
        case 'show-wind-radar':
            updateRadarVisibility();
            break;

        case 'show-speed-indicators':
            updateSpeedIndicatorVisibility();
            break;

        case 'show-hourly-stripes':
            updatePremiumWeatherDisplay();
            break;
        case 'show-stock-indicator':
            // Special handling for the master switch
            // If it's being enabled, start updates
            if (value) {
                import('./stock.js').then(stockModule => {
                    if (typeof stockModule.startStockUpdates === 'function') {
                        stockModule.startStockUpdates();
                    }
                });
            } else {
                import('./stock.js').then(stockModule => {
                    if (typeof stockModule.stopStockUpdates === 'function') {
                        stockModule.stopStockUpdates();
                    }
                });
            }
            // Update visibility state and fetch fresh data
            import('./stock.js').then(stockModule => {
                if (typeof stockModule.updateStockIndicatorVisibility === 'function') {
                    stockModule.updateStockIndicatorVisibility();
                }
                if (typeof stockModule.fetchStockData === 'function') {
                    stockModule.fetchStockData();
                }
            });
            // Enable/disable the "Stock Price and % Change" setting based on this toggle
            setControlEnable('show-price-alt', value);
            break;

        case 'satellite-use-location':
        case 'sat-region':
            // Initialize satellite settings when they change
            import('./wx.js').then(wxModule => {
                if (typeof wxModule.initializeSatelliteSettings === 'function') {
                    wxModule.initializeSatelliteSettings();
                }
            });
            break;

        case 'show-price-alt':
            import('./stock.js').then(stockModule => {
                if (typeof stockModule.setShowChange === 'function') {
                    stockModule.setShowChange(true);
                }
                if (typeof stockModule.fetchStockData === 'function') {
                    stockModule.fetchStockData();
                }
            });
            break;

        case 'show-news-count':
            // Update the news notification display immediately when this setting changes
            import('./news.js').then(newsModule => {
                if (typeof newsModule.updateNewsNotificationDot === 'function') {
                    newsModule.updateNewsNotificationDot();
                }
            });
            break;

        case 'dark-mode':
            if (value) {
                turnOnDarkMode();
            } else {
                turnOffDarkMode();
            }
            break;
            
        default:
            // Handle RSS-related settings
            if (key.startsWith('rss-')) {
                const isDrop = !value; // If unchecked, it's a drop
                
                // Only update news immediately if live_news_updates is true
                if (live_news_updates) {
                    // console.log(`RSS setting "${key}" changed to ${value}, updating news feed immediately`);
                    import('./news.js').then(newsModule => {
                        if (typeof newsModule.updateNews === 'function') {
                            newsModule.updateNews(isDrop);
                        }
                    });
                } else {
                    // console.log(`RSS setting "${key}" changed to ${value}, will update later (live_news_updates is false)`);
                    // Mark RSS as dirty so we can update after all settings are loaded
                    rssIsDirty = true;
                    rssDrop = rssDrop || isDrop; // If any feed was dropped, set flag
                }
            }
            break;
    }
}

// Function to enable/disable controls based on a setting
function setControlEnable(key, enabled = true) {
    const settingItems = document.querySelectorAll(`div[data-setting="${key}"]`);
    if (settingItems && settingItems.length > 0) {
        settingItems.forEach(item => {
            // Make div partly transparent
            item.style.opacity = enabled ? '1' : '0.35';

            // Handle checkbox toggle
            const toggle = item.querySelector('input[type="checkbox"]');
            if (toggle) {
                toggle.disabled = !enabled;
            }

            // Handle option-based toggles
            if (item.classList.contains('option-switch-container')) {
                const buttons = item.querySelectorAll('.option-button');
                buttons.forEach(btn => {
                    btn.disabled = !enabled;
                });
            }

            // Handle text input
            if (item.classList.contains('settings-text-item')) {
                const textInput = item.querySelector('input[type="text"]');
                if (textInput) {
                    textInput.disabled = !enabled;
                }
            }
        });
    }
}

// Initialize all toggle and text states based on 'settings' dictionary
function initializeSettings() {
    // Load stock/index data and generate settings
    loadStockAndIndexData();
    
    // Load news sources data and generate settings - use setTimeout to ensure DOM is ready
    setTimeout(() => {
        loadNewsSourcesData();
    }, 100);
    
    // Iterate through all keys in the settings object
    for (const key in settings) {
        if (settings.hasOwnProperty(key)) {
            const value = settings[key];
            updateSetting(key, value);
        }
    }
    autoDarkMode();
}

// Helper function to get current domain for cookie namespacing
function getCurrentDomain() {
    // Get hostname (e.g., example.com or beta.example.com)
    const hostname = window.location.hostname;
    // Convert to a safe string for use in cookie names
    return hostname.replace(/[^a-zA-Z0-9]/g, '_');
}

// Function to set a cookie with a specific name, value, and expiration in days
function setCookie(name, value, days = 36500) { // Default to ~100 years (forever)
    // Namespace the cookie name with the current domain
    const domainSpecificName = `${getCurrentDomain()}_${name}`;
    
    const d = new Date();
    d.setTime(d.getTime() + (days * 24 * 60 * 60 * 1000));
    const expires = "expires=" + d.toUTCString();
    document.cookie = domainSpecificName + "=" + value + ";" + expires + ";path=/";
    console.log(`Cookie set: ${domainSpecificName}=${value}, expires: ${d.toUTCString()}`);
}

// Function to get a cookie value by name
function getCookie(name) {
    // Namespace the cookie name with the current domain
    const domainSpecificName = `${getCurrentDomain()}_${name}`;
    const cookieName = domainSpecificName + "=";
    const decodedCookie = decodeURIComponent(document.cookie);
    const cookieArray = decodedCookie.split(';');
    
    // console.log(`All cookies: ${document.cookie}`);
    
    for (let i = 0; i < cookieArray.length; i++) {
        let cookie = cookieArray[i];
        while (cookie.charAt(0) === ' ') {
            cookie = cookie.substring(1);
        }
        if (cookie.indexOf(cookieName) === 0) {
            const value = cookie.substring(cookieName.length, cookie.length);
            console.log(`Cookie found: ${domainSpecificName}=${value}`);
            return value;
        }
    }
    console.log(`Cookie not found: ${domainSpecificName}`);
    return "";
}

// Function to delete a cookie by name
function deleteCookie(name) {
    // Namespace the cookie name with the current domain
    const domainSpecificName = `${getCurrentDomain()}_${name}`;
    document.cookie = domainSpecificName + "=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
    console.log(`Cookie deleted: ${domainSpecificName}`);
}

// Function to show the login modal
window.showLoginModal = function () {
    const modal = document.getElementById('login-modal');
    modal.style.display = 'flex';
    document.getElementById('user-id').focus();
    document.getElementById('login-error').textContent = ''; // Clear previous errors
}

// Function to hide the login modal
window.closeLoginModal = function () {
    document.getElementById('login-modal').style.display = 'none';
}

// Function to handle login/logout button
window.handleLogout = async function () {
    if (currentUser) {
        // Logging out of a named user; revert to auto-generated account
        stopSettingsPolling(); // Stop polling for the named user
        deleteCookie('userid');
        currentUser = null;
        hashedUser = null;

        const autoUser = getCookie('auto-userid');
        if (autoUser && await validateAutoUserId(autoUser)) {
            await fetchSettings();
            await initializeNewsStorage();
            updateNews(true);
            startSettingsPolling(5000); // Restart polling for auto user
        }
    } else {
        // Default user active, show login dialog
        showLoginModal();
    }
}

// Function to handle login from dialog
window.handleLogin = async function () {
    const userId = document.getElementById('user-id').value.trim();
    closeLoginModal();
    console.log('Attempting login with user ID: ', userId);
    try {
        if (await validateUserId(userId)) {
            console.log('User ID validated successfully.');
            await fetchSettings();
            
            // Initialize news storage for the newly logged in user
            await initializeNewsStorage();
            
            console.log('Login successful, updating news feed...');
            updateNews(true); // Update news feed after login
            
            // Start polling for settings updates
            startSettingsPolling(5000);
        }
    } catch (error) {
        console.error('Error fetching settings: ', error);
    }
}

// Function to enable live news updates and trigger initial update
export function enableLiveNewsUpdates() {
    console.log('Enabling live news updates');
    live_news_updates = true;
    
    // If any RSS settings were changed during startup, update now
    if (rssIsDirty) {
        console.log('RSS settings were changed, triggering update now');
        import('./news.js').then(newsModule => {
            if (typeof newsModule.updateNews === 'function') {
                newsModule.updateNews(rssDrop);
            }
        });
        rssIsDirty = false;
        rssDrop = false;
    }
}

// Function called by the toggle UI elements
window.toggleSettingFrom = function(element) {
    console.log('Toggle setting from UI element.');
    // const settingItem = element.closest('.settings-toggle-item');
    // Find closest element with a data-setting attribute
    const settingItem = element.closest('[data-setting]');
    if (settingItem && settingItem.dataset.setting) {
        const key = settingItem.dataset.setting;
        const value = element.checked;
        saveSetting(key, value);
    }
}

// Function for toggling option-based settings (e.g. map-choice)
window.toggleOptionSetting = function(button) {
    // console.log(`Option setting "${key}" changed to "${value}"`);
    
    const settingItem = button.closest('.option-switch-container');
    if (!settingItem || !settingItem.dataset.setting) return;

    const key = settingItem.dataset.setting;
    let value = button.dataset.value;
    
    // Handle special cases for compatibility
    if (key === 'imperial-units') {
        // Convert value to boolean
        value = (value === 'english');
    }
    
    // Store the setting
    saveSetting(key, value);
}

// Function called by the text input UI elements for text-based settings
window.updateSettingFrom = function(element) {
    const settingItem = element.closest('.settings-text-item');
    if (settingItem && settingItem.dataset.setting) {
        const key = settingItem.dataset.setting;
        const value = element.value.trim();
        saveSetting(key, value);
    }
}
