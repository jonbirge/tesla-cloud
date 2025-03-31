// Imports
import { updateNews } from './news.js';
import { customLog } from './common.js';
import { updateChartAxisColors } from './net.js';
import { autoDarkMode } from './wx.js';

// Global variables
let isLoggedIn = false;
let currentUser = null;
let hashedUser = null; // Store the hashed version of the user ID
let settings = {}; // Initialize settings object

// Export settings object so it's accessible to other modules
export { settings, currentUser, isLoggedIn };

// Default settings that will be used when no user is logged in
const defaultSettings = {
    // General settings
    "auto-dark-mode": true,
    "dark-mode": false,
    "24-hour-time": false,
    "imperial-units": true,
    // News source settings
    "rss-wsj": true,
    "rss-nyt": true,
    "rss-wapo": true,
    "rss-latimes": false,
    "rss-bos": false,
    "rss-bloomberg": false,
    "rss-bloomberg-tech": false,
    "rss-bbc": true,
    "rss-telegraph": false,
    "rss-economist": false,
    "rss-lemonde": false,
    "rss-derspiegel": false,
    "rss-notateslaapp": true,
    "rss-teslarati": true,
    "rss-insideevs": true,
    "rss-electrek": false,
    "rss-thedrive": false,
    "rss-techcrunch": true,
    "rss-jalopnik": false,
    "rss-theverge": false,
    "rss-arstechnica": true,
    "rss-engadget": false,
    "rss-gizmodo": false,
    "rss-defensenews": false,
};

// Function to initialize with defaults
function initializeSettings() {
    customLog('Using default settings (no login)');
    settings = { ...defaultSettings };
    initializeToggleStates();
    customLog('Settings initialized: ', settings);
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

// Update things that depend on dark mode
function updateDarkModeDependants() {
    updateChartAxisColors();
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

// Function to validate user ID, and if valid, set environment variables
async function validateUserId(userId) {
    // Check for minimum length (9 characters)
    if (userId.length < 9) {
        return { valid: false, message: 'User ID must be at least 9 characters long.' };
    }
    
    // Check for standard characters (letters, numbers, underscore, hyphen)
    const validFormat = /^[a-zA-Z0-9_-]+$/;
    if (!validFormat.test(userId)) {
        return { valid: false, message: 'User ID can only contain letters, numbers, underscore, and hyphen.' };
    }
    
    try {
        
        // Hash the user ID before sending to the server
        const hashedId = await hashUserId(userId);
        
        // Use HEAD request to check if the user exists
        const response = await fetch(`settings.php/${encodeURIComponent(hashedId)}`, {
            method: 'HEAD'
        });
        
        if (response.status === 404) {
            // User doesn't exist, create default settings
            const created = await createNewUser(userId, hashedId);
            if (!created) {
                return { valid: false, message: 'Failed to create new user.' };
            }
        } else if (!response.ok) {
            return { valid: false, message: 'Error checking user existence.' };
        }
        
        // User exists, set environment variables
        isLoggedIn = true;
        currentUser = userId;
        hashedUser = hashedId;
        customLog('User ID validated and logged in: ', userId, '(hashed: ', hashedId, ')');
        return { valid: true };

    } catch (error) {
        console.error('Error validating user ID:', error);
        return { valid: false, message: 'Network error during validation.' };
    }
}

// Pull all settings for a given user from REST server, creating user account with defaults if needed
async function fetchSettings(userId) {
    const validation = await validateUserId(userId); // returns true if valid user existed or was created
    if (validation.valid) {
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
        
                // Update UI
                updateLoginState();
                
                // Activate the settings section button
                document.getElementById('settings-section').classList.remove('hidden');
        
                // Save user ID in a cookie
                setCookie('userid', userId);

                // Initialize toggle states based on settings
                initializeToggleStates();

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
    } else {
        console.error('Invalid user ID: ', validation.message);
    }
}

// Function to create a new user with default settings
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
            isLoggedIn = true;
            currentUser = userId;
            hashedUser = hashedId;
            // Go through all values in the settings object and set them to the server
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

// Function to attempt login from cookie
export async function attemptLogin() {
    const urlParams = new URLSearchParams(window.location.search);
    let userId = urlParams.get('user');
    
    // If no userid in URL, try to get from cookie
    if (!userId) {
        userId = getCookie('userid');
        customLog('Checking for userid cookie:', userId ? 'found' : 'not found');
    }

    if (userId) {
        await fetchSettings(userId); // Fetch settings for the user
    } else {
        initializeSettings(); // No user ID found, use default settings
    }
}

// Update login/logout button visibility based on state
function updateLoginState() {
    const loginButton = document.getElementById('login-button');
    const logoutButton = document.getElementById('logout-button');

    if (isLoggedIn) {
        loginButton.classList.add('hidden');
        logoutButton.classList.remove('hidden');
        logoutButton.textContent = `Logout ${currentUser}`;
    } else {
        loginButton.classList.remove('hidden');
        logoutButton.classList.add('hidden');
        logoutButton.textContent = 'Logout';
    }
}

// Function to toggle a setting (updates both local cache and server)
export async function toggleSetting(key, value) {
    // Handle local settings
    settings[key] = value;

    // Update toggle state visually
    updateToggleVisualState(key, value);

    customLog(`Setting "${key}" updated to ${value} (local)`);

    // Update server if logged in
    if (isLoggedIn && currentUser) {
        try {
            // Update the local settings cache with boolean value
            settings[key] = value;

            // Update toggle state visually
            updateToggleVisualState(key, value);

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
            // customLog(`Initialized toggle for ${key}: ${value}`);
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
    
    // customLog(`All cookies: ${document.cookie}`);
    
    for (let i = 0; i < cookieArray.length; i++) {
        let cookie = cookieArray[i];
        while (cookie.charAt(0) === ' ') {
            cookie = cookie.substring(1);
        }
        if (cookie.indexOf(cookieName) === 0) {
            const value = cookie.substring(cookieName.length, cookie.length);
            customLog(`Cookie found: ${name}=${value}`);
            return value;
        }
    }
    customLog(`Cookie not found: ${name}`);
    return "";
}

function deleteCookie(name) {
    document.cookie = name + "=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
    customLog(`Cookie deleted: ${name}`);
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
    
    // If currently in settings section, redirect to news
    const sections = document.querySelectorAll('.section');
    const settingsSection = document.getElementById('settings');
    if (settingsSection.style.display === 'block') {
        showSection('news');
    }
    
    // Remove the userid cookie
    deleteCookie('userid');
}

// Function to handle login from dialog
window.handleLogin = async function () {
    const userId = document.getElementById('user-id').value.trim();
    closeLoginModal();
    customLog('Attempting login with user ID: ', userId);
    await fetchSettings(userId);
    customLog('Login done, updating news feed with new settings...');
    updateNews(true); // Update news feed after login
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
    const settingItem = element.closest('.settings-toggle-item');
    if (settingItem && settingItem.dataset.setting) {
        const key = settingItem.dataset.setting;
        const value = element.checked;
        toggleSetting(key, value);

        // If the setting is RSS-related, update the news feed
        if (key.startsWith('rss-')) {
            updateNews(true);
        }

        // If the setting is dark mode related, update the dark mode
        if (key === 'auto-dark-mode') {
            if (value) {
                autoDarkMode();
            }
        }
    }
}
