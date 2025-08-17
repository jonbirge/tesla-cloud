// Imports
import { updateNews, setShareButtonsVisibility, initializeNewsStorage } from './news.js';
import { updateNetChartAxisColors } from './net.js';
import { updatePremiumWeatherDisplay } from './wx.js';
import { startStockUpdates, stopStockUpdates } from './stock.js';
import { forecastDataPrem, lastLat, lastLong, updateRainChartAxisColors } from './wx.js';

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
    "show-hourly-stripes": true,
    // Stocks
    "show-price-alt": false,
    "show-stock-indicator": true,
    "show-stock-spy": false,    // S&P 500
    "show-stock-dia": false,    // Dow Jones
    "show-stock-iwm": false,    // Russell 2000
    "show-stock-ief": false,    // Treasury Bonds
    "show-stock-btco": false,   // Bitcoin
    "show-stock-tsla": false,   // Tesla
    // News forwarding
    "news-forwarding": false,
    "news-forward-only": false,
    "forwarding-email": "",
    // News sources
    "rss-wsj": true,
    "rss-nyt": true,
    "rss-wapo": false,
    "rss-latimes": false,
    "rss-bos": false,
    "rss-den": false,
    "rss-chi": false,
    "rss-bloomberg": false,
    "rss-ap": false,
    "rss-bbc": false,
    "rss-economist": false,
    "rss-lemonde": false,
    "rss-cnn": false,
    "rss-newyorker": false,
    "rss-notateslaapp": true,
    "rss-teslarati": true,
    "rss-insideevs": true,
    "rss-thedrive": false,
    "rss-techcrunch": false,
    "rss-caranddriver": true,
    "rss-theverge": false,
    "rss-arstechnica": false,
    "rss-engadget": true,
    "rss-gizmodo": false,
    "rss-wired": false,
    "rss-spacenews": false,
    "rss-defensenews": false,
    "rss-aviationweek": false,
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
    // if lat or long are null, then replace with last known values
    if (lat == null || long == null) {
        if (lastLat && lastLong) {
            lat = lastLat;
            long = lastLong;
        } else {
            console.log('autoDarkMode: No coordinates available.');
            return;
        }
    }

    console.log('Auto dark mode check for coordinates: ', lat, long);
    const sunrise = forecastDataPrem?.current.sunrise * 1000;
    const sunset = forecastDataPrem?.current.sunset * 1000;
    if (!sunrise || !sunset) {
        console.log('Auto dark mode: No sunrise/sunset data available.');
        return;
    }

    if (settings && settings['auto-dark-mode']) {
        const now = new Date();
        const currentTime = now.getTime();
        const sunriseTime = new Date(sunrise).getTime();
        const sunsetTime = new Date(sunset).getTime();

        if (currentTime >= sunsetTime || currentTime < sunriseTime) {
            console.log('Applying dark mode based on sunset...');
            //turnOnDarkMode();
            updateSetting('dark-mode', true);
        } else {
            console.log('Applying light mode based on sunrise...');
            //turnOffDarkMode();
            updateSetting('dark-mode', false);
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
            setDefaultSettings();
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
            const response = await fetch(`settings.php/${encodeURIComponent(hashedUser)}/${encodeURIComponent(key)}`, {
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

// Initialize settings with defaults
function setDefaultSettings() {
    settings = { ...defaultSettings };
    // initializeSettings();
    updateRadarVisibility();
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
async function validateHashedUserId(hashedId)
{
    try {
        // Use HEAD request to check if the user exists
        const response = await fetch(`settings.php/${encodeURIComponent(hashedId)}`, {
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

    if (await validateHashedUserId(hashedId)) {
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
        
        const response = await fetch(`settings.php/${encodeURIComponent(hashedId)}`, {
            method: 'POST'
        });
        
        if (response.ok) {
            console.log('Created new user with default settings:', userId);
            for (const [key, value] of Object.entries(settings)) {
                await saveSetting(key, value);
            }
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
        const response = await fetch('settings.php', {
            method: 'POST'
        });
        if (response.ok) {
            let data = await response.json();
            console.log('Auto-generated user ID:', data.userId);
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
    const loginButton = document.getElementById('login-button');
    const logoutButton = document.getElementById('logout-button');

    if (isLoggedIn) {
        loginButton.classList.add('hidden');
        logoutButton.classList.remove('hidden');
        if (currentUser) {
            logoutButton.textContent = `Logout ${currentUser}`;
        } else {
            logoutButton.textContent = 'Logout default user';
        }
    } else {
        loginButton.classList.remove('hidden');
        logoutButton.classList.add('hidden');
        logoutButton.textContent = 'Logout';
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
        const response = await fetch(`settings.php/${encodeURIComponent(hashedUser)}`, {
            method: 'GET'
        });

        if (response.ok) {
            // Load settings
            settings = await response.json();
            console.log('Settings loaded: ', settings);

            // Activate the settings section button
            document.getElementById('settings-section').classList.remove('hidden');

            // Initialize toggle states based on settings
            initializeSettings();
        } else {
            console.error('Error fetching settings: ', response.statusText);
        }
    } catch (error) {
        console.error('Error fetching settings: ', error);
    }
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

        case 'show-hourly-stripes':
            updatePremiumWeatherDisplay();
            break;
        case 'show-stock-indicator':
            // Special handling for the master switch
            // If it's being enabled, start updates
            if (value) {
                startStockUpdates();
            } else {
                stopStockUpdates();
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
            break;

        case 'show-stock-spy':
        case 'show-stock-dia':
        case 'show-stock-ief':
        case 'show-stock-btco':
        case 'show-stock-tsla':
        case 'show-stock-iwm':
            // For active indicators, adjust visibility and restart updates if needed
            if (value && settings["show-stock-indicator"] !== false) {
                // Start updates if this is a newly enabled indicator
                startStockUpdates();
            }
            // Update visibility and refresh data immediately
            import('./stock.js').then(stockModule => {
                if (typeof stockModule.updateStockIndicatorVisibility === 'function') {
                    stockModule.updateStockIndicatorVisibility();
                }
                if (typeof stockModule.fetchStockData === 'function') {
                    stockModule.fetchStockData();
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
                    console.log(`RSS setting "${key}" changed to ${value}, updating news feed immediately`);
                    import('./news.js').then(newsModule => {
                        if (typeof newsModule.updateNews === 'function') {
                            newsModule.updateNews(isDrop);
                        }
                    });
                } else {
                    console.log(`RSS setting "${key}" changed to ${value}, will update later (live_news_updates is false)`);
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

// Function to handle logout
window.handleLogout = function () {
    isLoggedIn = false;
    currentUser = null;
    hashedUser = null;
    
    // Update UI
    updateLoginState();
    
    // Hide settings section
    document.getElementById('settings-section').classList.add('hidden');
    
    // If currently in settings section, redirect to default section
    const settingsSection = document.getElementById('settings');
    if (settingsSection.style.display === 'block') {
        showSection('news');
    }
    
    // Ensure we won't auto login to a named user
    deleteCookie('userid');
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
