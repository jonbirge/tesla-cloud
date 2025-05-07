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
        return tzData.timezoneId;
    } catch (error) {
        console.error('Error fetching timezone: ', error);
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        console.log('Fallback timezone: ', tz);
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

// ***** Initialization *****

// URL parameters
const urlParams = new URLSearchParams(window.location.search);
const testParam = urlParams.get('test');
testMode = testParam === 'true';
if (testMode) {
    console.log('##### TEST MODE #####');
}
