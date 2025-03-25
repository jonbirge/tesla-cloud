// Global variables
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

// Function to attempt login from URL parameter or cookie
async function attemptLogin() {
    const urlParams = new URLSearchParams(window.location.search);
    let userId = urlParams.get('user');
    
    // If no userid in URL, try to get from cookie
    if (!userId) {
        userId = getCookie('userid');
        customLog('Checking for userid cookie:', userId ? 'found' : 'not found');
    }

    if (userId) {
        await fetchSettings(userId);
    }
}

async function fetchSettings(userId) {
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
                
                // Activate the settings section button
                document.getElementById('settings-section').classList.remove('hidden');
                
                // Update URL with userid parameter
                updateUrlWithUserId(userId);
        
                // Save user ID in a cookie
                setCookie('userid', userId);

                // Load settings
                settings = await response.json();
                customLog('Settings loaded: ', settings);
        
                // Initialize toggle states based on settings
                initializeToggleStates();
            } else {
                console.error('Error authenticating with user ID');
            }
        } catch (error) {
            console.error('Login error: ', error);
        }
    } else {
        console.error('Invalid user ID: ', validation.message);
    }
}

// Function to handle login from dialog
async function handleLogin() {
    const userId = document.getElementById('user-id').value.trim();
    closeLoginModal();
    fetchSettings(userId);
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
    url.searchParams.set('user', userId);
    window.history.pushState({}, '', url);
}

// Function to remove userId from URL
function removeUserIdFromUrl() {
    const url = new URL(window.location);
    url.searchParams.delete('user');
    window.history.pushState({}, '', url);
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
