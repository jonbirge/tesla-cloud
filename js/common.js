// Imports
import { settings } from './settings.js';

// Global variables
const GEONAMES_USERNAME = 'birgefuller';
let locationTimeZone = browserTimeZone();
let testMode = false; // Set to true if test parameter exists

// Exports
export { locationTimeZone, testMode, GEONAMES_USERNAME }

// Set time zone based on location
export async function updateTimeZone(lat, long) {
    try {
        const response = await fetch(`https://secure.geonames.org/timezoneJSON?lat=${lat}&lng=${long}&username=${GEONAMES_USERNAME}`);
        const tzData = await response.json();
        if (!tzData || !tzData.timezoneId) {
            throw new Error('Timezone not returned from server.');
        }
        console.log('Timezone: ', tzData.timezoneId);
        // Update global/exported timezone so formatters pick it up
        locationTimeZone = tzData.timezoneId;
        return tzData.timezoneId;
    } catch (error) {
        console.error('Error fetching timezone: ', error);
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        console.log('Fallback timezone: ', tz);
        // Still update the global/exported timezone
        locationTimeZone = tz;
        return tz;
    }
}

// Update element with a change-dependent highlight effect
export function highlightUpdate(id, content = null) {
    const element = document.getElementById(id);
    if (content !== null) {
        if (element.textContent === content) {
            return; // exit if content is the same
        }
        element.textContent = content;
    }
    const highlightColor = getComputedStyle(document.documentElement).getPropertyValue('--tesla-blue').trim();

    element.style.transition = 'color 0.5s, font-weight 0.5s';
    element.style.color = highlightColor;

    setTimeout(() => {
        element.style.transition = 'color 2s, font-weight 2s';
        element.style.color = ''; // Reset to default color
    }, 2000);
}

// Update src of element only if it needs to change to avoid reloads
export function srcUpdate(id, url) {
    const element = document.getElementById(id);
    const currentUrl = element.src;
    console.log('current src:', currentUrl);
    console.log('new src:', url);
    if (!(url === currentUrl)) {
        element.src = url;
        console.log('Updating src for', id);
    }
}

// Helper function to format time according to user settings
export function formatTime(date, options = {}) {
    // Default options
    const defaultOptions = {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: locationTimeZone
    };
    
    // Merge provided options with defaults
    const timeOptions = {...defaultOptions, ...options};
    
    // Check if 24-hour format is enabled in settings
    if (settings && settings['24-hour-time']) {
        timeOptions.hour12 = false;
    }
    
    return date.toLocaleTimeString('en-US', timeOptions);
}

// Return time zone based on browser settings
function browserTimeZone() {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    console.log('Browser timezone: ', tz);
    return tz;
}

// Show spinner within the specified container element
export function showSpinner(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    // Find an existing spinner in the container
    const existingSpinner = container.querySelector('.spinner-container');
    
    // If a spinner already exists, just make it visible
    if (existingSpinner) {
        existingSpinner.style.display = 'flex';
        return;
    }
    
    // If no spinner exists, create one
    const spinnerContainer = document.createElement('div');
    spinnerContainer.className = 'spinner-container';
    
    const spinner = document.createElement('div');
    spinner.className = 'spinner';
    
    spinnerContainer.appendChild(spinner);
    container.appendChild(spinnerContainer);
}

// Hide spinner within the specified container element
export function hideSpinner(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    // Find an existing spinner in the container
    const existingSpinner = container.querySelector('.spinner-container');
    
    // If a spinner exists, hide it
    if (existingSpinner) {
        existingSpinner.style.display = 'none';
    }
}

// Show a notification with the specified message
export function showNotification(message) {
    // Check if a notification container already exists
    let notificationContainer = document.getElementById('notification-container');
    
    if (!notificationContainer) {
        // Create a notification container if it doesn't exist
        notificationContainer = document.createElement('div');
        notificationContainer.id = 'notification-container';
        document.body.appendChild(notificationContainer);
    }
    
    // Create the notification element
    const notification = document.createElement('div');
    notification.className = 'notification';

    const iconDiv = document.createElement('div');
    iconDiv.className = 'notification-icon';
    const img = document.createElement('img');
    img.src = 'assets/cloud.svg';
    img.alt = 'Alert';
    img.width = 24;
    img.height = 24;
    iconDiv.appendChild(img);

    const messageDiv = document.createElement('div');
    messageDiv.className = 'notification-message';
    messageDiv.textContent = message;

    notification.appendChild(iconDiv);
    notification.appendChild(messageDiv);
    
    // Add the notification to the container
    notificationContainer.appendChild(notification);
    
    // Make the notification visible with a fade-in effect
    setTimeout(() => {
        notification.classList.add('show');
    }, 10);
    
    // Remove the notification after 5 seconds
    setTimeout(() => {
        notification.classList.remove('show');
        notification.classList.add('hide');
        
        // Remove the element after the fade-out animation completes
        setTimeout(() => {
            notification.remove();
            
            // Remove the container if there are no more notifications
            if (notificationContainer.children.length === 0) {
                notificationContainer.remove();
            }
        }, 500);
    }, 5000);
}

// ***** Initialization *****

// URL parameters
const urlParams = new URLSearchParams(window.location.search);
const testParam = urlParams.get('test');
testMode = testParam === 'true';
if (testMode) {
    console.log('##### TEST MODE #####');
}
