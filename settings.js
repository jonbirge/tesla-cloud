// Imports
import { updateNews, setShareButtonsVisibility } from './news.js';
import { customLog } from './common.js';
import { updateChartAxisColors } from './net.js';
import { autoDarkMode } from './wx.js';

// Global variables
let isLoggedIn = false;
let currentUser = null; // Will be NULL if not logged in OR if using auto-generated ID
let hashedUser = null; // The hashed version of the user ID
let rssIsDirty = false; // Flag to indicate if RSS settings have changed
let rssDrop = false; // Flag to indicate if an RSS feed has been dropped
let settings = {}; // Initialize settings object

// Export settings object so it's accessible to other modules
export { settings, currentUser, isLoggedIn, hashedUser };

// Default settings that will be used when no user is logged in
const defaultSettings = {
    // General settings
    "dark-mode": false,
    "auto-dark-mode": true,
    "24-hour-time": false,
    "imperial-units": true,    // "English" or "Metric"
    "map-choice": 'waze',
    "show-wind-radar": true, // Show/hide wind radar by default
    // News forwarding
    "news-forwarding": false,
    "news-forward-only": false,
    "forwarding-email": "",
    // News source settings
    "rss-wsj": true,
    "rss-nyt": true,
    "rss-wapo": true,
    "rss-latimes": false,
    "rss-bos": false,
    "rss-den": false,
    "rss-chi": false,
    "rss-bloomberg": false,
    "rss-bloomberg-tech": false,
    "rss-bbc": true,
    "rss-economist": false,
    "rss-lemonde": false,
    "rss-derspiegel": false,
    "rss-notateslaapp": true,
    "rss-teslarati": true,
    "rss-insideevs": true,
    "rss-thedrive": false,
    "rss-techcrunch": true,
    "rss-jalopnik": false,
    "rss-caranddriver": true,
    "rss-theverge": false,
    "rss-arstechnica": true,
    "rss-engadget": false,
    "rss-gizmodo": false,
    "rss-wired": false,
    "rss-spacenews": false,
    "rss-defensenews": false,
};

// Settings section is being left
export function leaveSettings() {
    if (rssIsDirty) {
        customLog('RSS settings are dirty, updating news feed.')
        // If RSS is dirty, update the news feed
        updateNews(rssDrop);
        rssIsDirty = false; // Reset the dirty flag
        rssDrop = false; // Reset the drop flag
    }
}

// Turn on dark mode
export function turnOnDarkMode() {
    document.body.classList.add('dark-mode');
    document.getElementById('darkModeToggle').checked = true;
    toggleSetting('dark-mode', true);
    updateDarkModeDependants();
}

// Turn off dark mode
export function turnOffDarkMode() {
    document.body.classList.remove('dark-mode');
    document.getElementById('darkModeToggle').checked = false;
    toggleSetting('dark-mode', false);
    updateDarkModeDependants();
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
            customLog('Logged in named user ID: ', userId);
            await fetchSettings();
        }
    } else {  // Fall back to an auto-generated one
        const autoGeneratedId = getCookie('auto-userid');

        if (autoGeneratedId && await validateAutoUserId(autoGeneratedId)) {
            customLog('Logged in auto-generated ID: ', autoGeneratedId);
            await fetchSettings();
        } else {
            customLog('No user IDs found, creating new auto-generated user...');
            initializeSettings();
            const newAutoUser = await autoCreateUser(); // Create a new user and log them in
            if (await validateAutoUserId(newAutoUser)) {
                for (const [key, value] of Object.entries(settings)) {
                    await toggleSetting(key, value);
                }
            }
        }
    }

    // Log final state of currentUser, hashedUser, and isLoggedIn
    customLog('currentUser:', currentUser);
    customLog('hashedUser:', hashedUser);
    customLog('isLoggedIn:', isLoggedIn);

    // Initialize map frame option
    updateMapFrame();
}

// Function to toggle a setting (updates both local cache and server)
// TODO: Handle the special cases via callbacks from new Settings object?
export async function toggleSetting(key, value) {
    // Handle local settings
    settings[key] = value;

    // Update toggle state visually
    updateToggleVisualState(key, value);

    customLog(`Setting "${key}" updated to ${value} (local)`);

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
                customLog(`Setting "${key}" updated to ${value} (server)`);
            } else {
                customLog(`Failed to update setting "${key}" on server`);
            }
        } catch (error) {
            customLog('Error toggling setting:', error);
        }
    }

    // If the setting is RSS-related, set the dirty flag
    if (key.startsWith('rss-')) {
        const isDrop = !value; // If unchecked, it's a drop
        rssIsDirty = true;
        rssDrop = rssDrop || isDrop; // Set the drop flag if this is a drop
        customLog(`RSS setting "${key}" changed to ${value} (dirty: ${rssIsDirty}, drop: ${rssDrop})`);
    }

    // If the setting is dark mode related, update the dark mode
    if (key === 'auto-dark-mode') {
        if (value) {
            autoDarkMode();
        }
    }

    // Handle map choice setting
    if (key === 'map-choice') {
        updateMapFrame();
    }

    // If the setting is news forwarding, update the share buttons
    if (key === 'news-forwarding') {
        setShareButtonsVisibility();
    }

    // Show/hide radar if setting changes
    if (key === 'show-wind-radar') {
        updateRadarVisibility();
    }
}

// Function to initialize with defaults
function initializeSettings() {
    settings = { ...defaultSettings };
    initializeToggleStates();
    updateRadarVisibility();
    customLog('Settings initialized: ', settings);
}

// Update things that depend on dark mode
function updateDarkModeDependants() {
    updateChartAxisColors();
}

// Function to show/hide radar display based on setting
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
        customLog('User validated on server: ', hashedId);
        return true;
    } catch (error) {
        isLoggedIn = false;
        hashedUser = null;
        currentUser = null;
        console.error('Error validating user: ', error);
        return false;
    }
}

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
            customLog('Created new user with default settings:', userId);
            for (const [key, value] of Object.entries(settings)) {
                await toggleSetting(key, value);
            }
            return true;
        } else {
            customLog('Failed to create new user:', userId);
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
            customLog('Auto-generated user ID:', data.userId);
            return data.userId;
        } else {
            customLog('Failed to fetch random user ID from server');
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
        customLog('No hashed user ID available, cannot fetch settings.');
        return;
    }

    try {
        // Fetch settings using RESTful API
        customLog('Fetching settings for user: ', hashedUser);
        const response = await fetch(`settings.php/${encodeURIComponent(hashedUser)}`, {
            method: 'GET'
        });

        if (response.ok) {
            // Load settings
            settings = await response.json();
            customLog('Settings loaded: ', settings);

            // Activate the settings section button
            document.getElementById('settings-section').classList.remove('hidden');

            // Initialize toggle states based on settings
            initializeToggleStates();
            updateRadarVisibility();

            // Handle dark mode
            if (settings['dark-mode']) {
                turnOnDarkMode();
            } else {
                turnOffDarkMode();
            }
        } else {
            console.error('Error fetching settings: ', response.statusText);
        }
    } catch (error) {
        console.error('Error fetching settings: ', error);
    }
}

// Update visual state of a toggle or text input
function updateToggleVisualState(key, value) {
    const settingItems = document.querySelectorAll(`.settings-toggle-item[data-setting="${key}"]`);

    // Special compatibility cases
    if (key === 'imperial-units') {
        let unitsValue;
        if (value === true) {
            value = 'english';
        } else {
            value = 'metric';
        }
    }

    customLog(`Updating visual state for "${key}" to ${value}`);
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

    // Disable/enable forwarding-email input based on news-forwarding
    if (key === 'news-forwarding') {
        setControlEnable('forwarding-email', value);
        setControlEnable('news-forward-only', value);
    }
}

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
function initializeToggleStates() {
    // Iterate through all keys in the settings object
    for (const key in settings) {
        if (settings.hasOwnProperty(key)) {
            const value = settings[key];
            updateToggleVisualState(key, value);
        }
    }
    updateRadarVisibility();
}

// Helper function to get current domain for cookie namespacing
function getCurrentDomain() {
    // Get hostname (e.g., example.com or beta.example.com)
    const hostname = window.location.hostname;
    // Convert to a safe string for use in cookie names
    return hostname.replace(/[^a-zA-Z0-9]/g, '_');
}

function setCookie(name, value, days = 36500) { // Default to ~100 years (forever)
    // Namespace the cookie name with the current domain
    const domainSpecificName = `${getCurrentDomain()}_${name}`;
    
    const d = new Date();
    d.setTime(d.getTime() + (days * 24 * 60 * 60 * 1000));
    const expires = "expires=" + d.toUTCString();
    document.cookie = domainSpecificName + "=" + value + ";" + expires + ";path=/";
    customLog(`Cookie set: ${domainSpecificName}=${value}, expires: ${d.toUTCString()}`);
}

function getCookie(name) {
    // Namespace the cookie name with the current domain
    const domainSpecificName = `${getCurrentDomain()}_${name}`;
    const cookieName = domainSpecificName + "=";
    const decodedCookie = decodeURIComponent(document.cookie);
    const cookieArray = decodedCookie.split(';');
    
    // customLog(`All cookies: ${document.cookie}`);
    
    for (let i = 0; i < cookieArray.length; i++) {
        let cookie = cookieArray[i];
        while (cookie.charAt(0) === ' ') {
            cookie = cookie.substring(1);
        }
        if (cookie.indexOf(cookieName) === 0) {
            const value = cookie.substring(cookieName.length, cookie.length);
            customLog(`Cookie found: ${domainSpecificName}=${value}`);
            return value;
        }
    }
    customLog(`Cookie not found: ${domainSpecificName}`);
    return "";
}

function deleteCookie(name) {
    // Namespace the cookie name with the current domain
    const domainSpecificName = `${getCurrentDomain()}_${name}`;
    document.cookie = domainSpecificName + "=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
    customLog(`Cookie deleted: ${domainSpecificName}`);
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
    customLog('Attempting login with user ID: ', userId);
    try {
        if (await validateUserId(userId)) {
            customLog('User ID validated successfully.');
            await fetchSettings();
            customLog('Login successful, updating news feed...');
            updateNews(true); // Update news feed after login
        }
    } catch (error) {
        console.error('Error fetching settings: ', error);
    }
}

// Manually swap dark/light mode
window.toggleMode = function () {
    toggleSetting('auto-dark-mode', false);
    document.body.classList.toggle('dark-mode');
    const darkMode = document.body.classList.contains('dark-mode');
    document.getElementById('darkModeToggle').checked = darkMode;
    toggleSetting('dark-mode', darkMode);
    updateDarkModeDependants();
}

// Function called by the toggle UI elements
// TODO: Handle special cases in toggleSetting(), and deal with RSS by setting "dirty" flag triggering update the next time news is selected.
window.toggleSettingFrom = function(element) {
    customLog('Toggle setting from UI element.');
    // const settingItem = element.closest('.settings-toggle-item');
    // Find closest element with a data-setting attribute
    const settingItem = element.closest('[data-setting]');
    if (settingItem && settingItem.dataset.setting) {
        const key = settingItem.dataset.setting;
        const value = element.checked;
        toggleSetting(key, value);
    }
}

// Function for toggling option-based settings (like map-choice)
window.toggleOptionSetting = function(button) {
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
    toggleSetting(key, value);
    customLog(`Option setting "${key}" changed to "${value}"`);
}

// Function called by the text input UI elements for text-based settings
window.updateSettingFrom = function(element) {
    const settingItem = element.closest('.settings-text-item');
    if (settingItem && settingItem.dataset.setting) {
        const key = settingItem.dataset.setting;
        const value = element.value.trim();
        toggleSetting(key, value);
    }
}
