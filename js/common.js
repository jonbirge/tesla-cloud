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

// Show a notification with the specified message and type
export function showNotification(message, type = 'warning') {
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
    
    // Set icon and styling based on notification type
    switch (type) {
        case 'success':
            iconDiv.style.display = 'none';
            notification.style.backgroundColor = 'rgba(33, 129, 13, 0.85)';
            break;
        case 'error':
            img.src = 'assets/warn.svg';
            img.alt = 'Error';
            notification.style.backgroundColor = 'rgba(255, 165, 0, 0.85)';
            break;
        case 'warning':
            img.src = 'assets/cloud.svg';
            img.alt = 'Alert';
            notification.style.backgroundColor = 'rgba(0, 0, 0, 0.75)';
            break;
        default:
            iconDiv.style.display = 'none';
            notification.style.backgroundColor = 'rgba(0, 0, 0, 0.75)';
            break;
    }
    
    // Increase icon size for better visibility in pop-up alerts
    img.width = 32;
    img.height = 32;
    iconDiv.appendChild(img);

    const messageDiv = document.createElement('div');
    messageDiv.className = 'notification-message';
    messageDiv.textContent = message;
    
    // Set text color based on type
    switch (type) {
        case 'success':
            messageDiv.style.color = 'white';
            break;
        case 'error':
            messageDiv.style.color = 'white';
            break;
        case 'warning':
            messageDiv.style.color = '#ff9500';
            break;
        default:
            messageDiv.style.color = 'white';
            break;
    }

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

// Show a weather alert modal that requires acknowledgment
export function showWeatherAlertModal(alert) {
    // Remove any existing weather alert modal
    const existingModal = document.getElementById('weather-alert-modal');
    if (existingModal) {
        existingModal.remove();
    }

    // Create modal overlay
    const modalOverlay = document.createElement('div');
    modalOverlay.id = 'weather-alert-modal';
    modalOverlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.8);
        z-index: 10000;
        display: flex;
        justify-content: center;
        align-items: center;
    `;

    // Create modal content
    const modalContent = document.createElement('div');
    modalContent.style.cssText = `
        background-color: #1a1a1a;
        border: 3px solid #ff0000;
        border-radius: 12px;
        padding: 24px;
        max-width: 600px;
        width: 90%;
        text-align: center;
        box-shadow: 0 8px 32px rgba(255, 0, 0, 0.3);
    `;

    // Create alert icon
    const alertIcon = document.createElement('div');
    alertIcon.style.cssText = `
        font-size: 48px;
        color: #ff0000;
        margin-bottom: 16px;
        width: 48px;
        height: 48px;
        margin: 0 auto 16px auto;
    `;
    alertIcon.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 100%; height: 100%;">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
    `;

    // Create alert title
    const alertTitle = document.createElement('h2');
    alertTitle.style.cssText = `
        color: #ff0000;
        margin: 0 0 16px 0;
        font-size: 24px;
        font-weight: bold;
    `;
    alertTitle.textContent = alert.event || 'Weather Alert';

    // Create alert description
    const alertDescription = document.createElement('p');
    alertDescription.style.cssText = `
        color: white;
        margin: 0 0 24px 0;
        line-height: 1.4;
        font-size: 16px;
    `;
    alertDescription.textContent = alert.description || 'Significant weather event detected.';

    // Create time info
    const timeInfo = document.createElement('p');
    timeInfo.style.cssText = `
        color: #ccc;
        margin: 0 0 24px 0;
        font-size: 14px;
    `;
    const startTime = new Date(alert.start * 1000).toLocaleString();
    const endTime = new Date(alert.end * 1000).toLocaleString();
    timeInfo.textContent = `Valid: ${startTime} - ${endTime}`;

    // Create acknowledge button
    const acknowledgeBtn = document.createElement('button');
    acknowledgeBtn.style.cssText = `
        background-color: #ff0000;
        color: white;
        border: none;
        padding: 12px 24px;
        border-radius: 6px;
        font-size: 16px;
        font-weight: bold;
        cursor: pointer;
        min-width: 120px;
    `;
    acknowledgeBtn.textContent = 'Acknowledge';
    acknowledgeBtn.onclick = () => {
        modalOverlay.remove();
    };

    // Assemble modal
    modalContent.appendChild(alertIcon);
    modalContent.appendChild(alertTitle);
    modalContent.appendChild(alertDescription);
    modalContent.appendChild(timeInfo);
    modalContent.appendChild(acknowledgeBtn);
    modalOverlay.appendChild(modalContent);

    // Add to page
    document.body.appendChild(modalOverlay);

    // Focus the acknowledge button for keyboard accessibility
    acknowledgeBtn.focus();
}

// ***** Initialization *****

// URL parameters
const urlParams = new URLSearchParams(window.location.search);
const testParam = urlParams.get('test');
testMode = testParam === 'true';
if (testMode) {
    console.log('##### TEST MODE #####');
}
