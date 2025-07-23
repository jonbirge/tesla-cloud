// Imports
import { settings, isDriving, hashedUser, isLoggedIn } from './settings.js';
import { showSpinner, hideSpinner, showNotification } from './common.js';

// Constants
const BASE_URL = 'news.php?n=256';
const RESTDB_URL = 'rest_db.php';
const NEWS_REFRESH_INTERVAL = 2.5;  // minutes
const CLEANUP_INTERVAL = 120;       // minutes
const MAX_AGE_DAYS = 2;             // Maximum age in days for seen news IDs

// Variables
let newsUpdateInterval = null;
let newsTimeUpdateInterval = null;  // Interval for updating "time ago" displays
let newsObserver = null;            // Intersection Observer for tracking visible news items
let pendingReadItems = new Set();   // Track items that are currently visible but not yet marked as read
let cachedSeenNewsIds = null;       // Cache for seen news IDs to reduce API calls
let directoryInitialized = false;   // Track if we've successfully initialized the directory in this session
let lastDirectoryCheckTime = 0;
let displayedItems = [];            // Store loaded news items
let hasUnreadNewsItems = false;     // Track if there are any unread news items
let updatingNews = false;

// Export function to ensure user directory exists (used by app.js during startup)
export async function initializeNewsStorage() {
    // Reset the cache when initializing
    cachedSeenNewsIds = null;
    directoryInitialized = false;
    lastDirectoryCheckTime = 0;
    
    console.log('Initializing news storage system...');
    
    // If user is logged in, ensure directory exists and clean up old entries
    if (isLoggedIn && hashedUser) {
        console.log(`Initializing news storage for user: ${hashedUser}`);
        
        // Try to create user directory with maximum retry attempts
        const success = await ensureUserDirectoryExists(3); // Try up to 4 times with increasing delays
        
        if (success) {
            console.log('News storage directory initialized successfully');
            
            try {
                // Verify we can access the directory by getting the current entries
                const seenIds = await getSeenNewsIds();
                const count = Object.keys(seenIds).length;
                console.log(`Successfully accessed news storage with ${count} existing entries`);
                return true;
            } catch (error) {
                console.error('Error during news storage verification:', error);
                // We'll continue despite verification error since directory exists
                return true;
            }
        } else {
            console.error('Failed to initialize news storage after multiple attempts');
            // Add fallback mechanism to local storage if restdb fails repeatedly
            console.warn('Using in-memory storage only as fallback');
            return false;
        }
    } else {
        console.log('User not logged in, skipping news storage initialization');
        return false;
    }
}

// Helper functions for rest_db.php management
async function ensureUserDirectoryExists(retryCount = 2) {
    const DIRECTORY_CHECK_INTERVAL = 60000; // Only try once per minute at most

    // Skip if not logged in
    if (!isLoggedIn || !hashedUser) {
        return false;
    }
    
    // If we've already successfully initialized the directory in this session
    // and a forced check isn't requested, skip the check
    if (directoryInitialized && retryCount === 2) {
        console.log('Skipping directory check - already initialized in this session');
        return true;
    }
    
    // Avoid excessive calls - only check once per minute unless forced with retryCount > 0
    const now = Date.now();
    if (retryCount === 2 && now - lastDirectoryCheckTime < DIRECTORY_CHECK_INTERVAL) {
        console.log('Skipping directory check - checked recently');
        return true; // Assume it exists if we checked recently
    }
    
    try {
        console.log(`Ensuring user directory exists for: ${hashedUser}`);
        
        // First check if the directory exists via GET
        let directoryExists = false;
        try {
            const checkResponse = await fetch(`${RESTDB_URL}/${hashedUser}/`, {
                method: 'GET'
            });
            
            // If response is 404, directory doesn't exist
            // If response is 200, directory exists and is empty or has content
            directoryExists = checkResponse.ok;
            
            if (directoryExists) {
                console.log('Directory exists, verified via GET');
                directoryInitialized = true;
                lastDirectoryCheckTime = now;
                return true;
            }
        } catch (error) {
            // Ignore check errors, we'll still try to create
            console.warn('Error checking if directory exists:', error);
        }
        
        // If not exists or check failed, use POST to create the directory
        console.log('Attempting to create directory via POST');
        const response = await fetch(`${RESTDB_URL}/${hashedUser}/`, {
            method: 'POST'
        });
        
        // Update check timestamp
        lastDirectoryCheckTime = now;
        
        // Check response
        if (response.ok) {
            console.log('User directory created successfully');
            directoryInitialized = true; // Mark directory as initialized
            return true;
        } 
        // If directory already exists, that's fine (HTTP 409 Conflict or 200 with message)
        else if (response.status === 409 || response.status === 200) {
            try {
                const data = await response.json();
                if (data.message && data.message.includes('already exists')) {
                    console.log('User directory already exists');
                    directoryInitialized = true;
                    return true;
                }
            } catch (e) {
                // If we can't parse the response, assume it exists
                console.log('Assuming directory exists (got response but could not parse)');
                directoryInitialized = true;
                return true;
            }
            
            // Just in case the JSON parse fails but it was a 409/200
            if (response.status === 409 || response.status === 200) {
                console.log(`User directory likely exists (got ${response.status})`);
                directoryInitialized = true;
                return true;
            }
        }
        // Server error (5xx) - maybe retry
        else if (response.status >= 500 && retryCount > 0) {
            console.warn(`Server error (${response.status}) when creating directory, retrying...`);
            // Wait a bit before retrying (exponential backoff)
            await new Promise(resolve => setTimeout(resolve, 1000 * (3 - retryCount)));
            return ensureUserDirectoryExists(retryCount - 1);
        }
        // Any other error
        else {
            console.error(`Failed to create user directory: ${response.status}`);
            // Try to get more details from the error response
            try {
                const errorData = await response.json();
                console.error('Error details:', errorData);
            } catch (e) {
                // Ignore if we can't parse the error response
            }
            return false;
        }
    } catch (error) {
        console.error('Error creating user directory:', error);
        
        // Network errors might be transient, try again if we have retries left
        if (retryCount > 0) {
            console.warn('Retrying after network error...');
            await new Promise(resolve => setTimeout(resolve, 1000 * (3 - retryCount)));
            return ensureUserDirectoryExists(retryCount - 1);
        }
        
        return false;
    }
}

// Get seen news IDs from rest_db.php
async function getSeenNewsIds() {
    // If not logged in, return empty object
    if (!isLoggedIn || !hashedUser || !directoryInitialized) {
        console.log('User not logged in, returning empty seen news IDs');
        return {};
    }
    
    // If we have cached data, return it
    if (cachedSeenNewsIds !== null) {
        return cachedSeenNewsIds;
    }
    
    try {        
        // Log the request for debugging
        console.log(`Fetching news IDs from: ${RESTDB_URL}/${hashedUser}/`);
        
        // Get the directory contents
        const response = await fetch(`${RESTDB_URL}/${hashedUser}/`);
        
        // Special response code handling
        if (!response.ok) { 
            console.error('Error fetching seen news IDs:', response.status);
            return {};
        }
        
        // Process the response data
        const data = await response.json();
        
        // Convert the array of keys/values to an object format
        const result = {};
        if (Array.isArray(data)) {
            data.forEach(item => {
                if (item.isDir) {
                    return; // Skip directories
                }
                // Extract the article ID from the path
                const articleId = item.key.split('/').pop();
                // Parse the timestamp from the JSON string
                try {
                    const timestamp = JSON.parse(item.value);
                    result[articleId] = timestamp;
                } catch (e) {
                    console.warn(`Could not parse timestamp for article ${articleId}:`, e);
                }
            });
            console.log(`Processed ${Object.keys(result).length} article IDs from restdb`);
        } else {
            console.warn('Unexpected response format from restdb (not an array):', data);
        }
        
        // Cache the result
        cachedSeenNewsIds = result;
        return result;
    } catch (error) {
        console.error('Error fetching seen news IDs:', error);
        return {};
    }
}

// Mark a news item as seen
async function markNewsSeen(id) {
    // If not logged in, don't persist
    if (!isLoggedIn || !hashedUser || !directoryInitialized) {
        return;
    }

    try {
        // Store the timestamp as JSON
        const timestamp = Date.now();     
        const response = await fetch(`${RESTDB_URL}/${hashedUser}/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(timestamp)
        });

        if (response.ok) {
            console.log(`Successfully marked article ${id} as seen.`);
            // Update the cache
            if (cachedSeenNewsIds !== null) {
                cachedSeenNewsIds[id] = timestamp;
            }
        } else {
            console.log(`Something went wrong marking article ${id} as seen...`);
        }
    } catch (error) {
        console.error(`Error caught marking news item ${id} as seen:`, error);
    }
}

// Updates the news headlines, optionally clearing existing ones
export async function updateNews(clear = false) {
    if (updatingNews) {
        console.log('*** Already updating news! Quitting...');
        return;
    } else {
        updatingNews = true;
    }

    try {
        // Collect included RSS feeds from user settings
        const includedFeeds = [];
        if (settings) {
            // Collect all RSS feed settings that are set to true
            for (const key in settings) {
                if (key.startsWith('rss-') && settings[key] === true) {
                    // Extract feed ID after the "rss-" prefix
                    const feedId = key.substring(4);
                    includedFeeds.push(feedId);
                }
            }
        }
        
        // Get the news container element
        const newsContainer = document.getElementById('newsHeadlines');

        // Clear the news container as needed
        if (clear) {
            console.log('Clearing news headlines...');
            newsContainer.innerHTML = '';
            displayedItems = [];
        }

        // Show loading spinner if no items are displayed yet or only showing a message
        const isEmpty = !newsContainer.innerHTML || newsContainer.innerHTML.trim() === '';
        if (isEmpty) {
            document.getElementById('news-loading').style.display = 'flex';
            newsContainer.style.display = 'none';
        }
        
        console.log('Fetching news headlines...');
        // if (includedFeeds.length > 0) {
        //     console.log('Including RSS feeds:', includedFeeds);
        // } else {
        //     console.log('No RSS feeds selected, showing all available feeds');
        // }
        
        // Copy displayedItems to oldDisplayedItems
        let oldDisplayedItems = [...displayedItems];

        // Send the request with included feeds in the body
        const response = await fetch(BASE_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ includedFeeds })
        });
        let loadedItems = await response.json();
        console.log('...Done! Count: ', loadedItems.length);
        
        // Hide the spinner when data arrives
        document.getElementById('news-loading').style.display = 'none';
        newsContainer.style.display = 'block';

        // Add a unique ID to each item
        loadedItems.forEach(item => {
            // Create a unique ID based on title and source
            item.id = genItemID(item);
        });
        
        // Filter out items where the ID can be found in oldDisplayedItems
        const nLoaded = loadedItems.length;
        // Create a Set of oldDisplayedIds for O(1) lookups instead of O(n) with Array.includes()
        const oldDisplayedIdsSet = new Set(oldDisplayedItems.map(item => item.id));
        // Filter using the Set for much faster lookups
        loadedItems = loadedItems.filter(item => !oldDisplayedIdsSet.has(item.id));
        const nFiltered = loadedItems.length;
        console.log(`Left with ${nFiltered} out of ${nLoaded} loaded items after filtering existing displayed items`);

        // Clean items from oldDisplayedItems from sources that are not in includedFeeds
        if (includedFeeds.length > 0) {
            const includedSources = new Set(includedFeeds);
            oldDisplayedItems = oldDisplayedItems.filter(item => {
                return includedSources.has(item.source);
            });
        }
        
        // Track if we have unread items among newly loaded items...
        if (loadedItems.length > 0) {            
            // Mark each item's read status
            loadedItems.forEach(item => {
                // Check if this is a new item
                item.isUnread = !(item.id in cachedSeenNewsIds);
            });

            // Remove items that have isUnread flag set to false
            loadedItems = loadedItems.filter(item => item.isUnread);
        }

        // ...and update the read status of old displayed items
        if (oldDisplayedItems.length > 0) {
            oldDisplayedItems.forEach(item => {
                // Check if this is a new item
                item.isUnread = !(item.id in cachedSeenNewsIds);
            });
        }

        // If anything has made it past all the filters, sort by date
        if (loadedItems.length > 0) {
            console.log('We have unread items among newly loaded items!');
            loadedItems.sort((a, b) => b.date - a.date);
        }

        // Create new displayed items array by joining loadedItems and oldDisplayedItems
        displayedItems = [...loadedItems, ...oldDisplayedItems];

        // Update the news container with the new items
        if (displayedItems.length > 0) {
            newsContainer.innerHTML = displayedItems.map(generateHTMLforItem).join('');
            
            // Set up the observer to track visible news items
            setupNewsObserver();
            
            // Update notification dot status based on unread items
            updateNewsNotificationDot();

            // Update the visibility of share buttons
            setShareButtonsVisibility();
        } else {
            newsContainer.innerHTML = '<p><em>No headlines available</em></p>';
        }
    } catch (error) {
        console.error('Error fetching news:', error);
        console.log('Error fetching news:', error);
        
        // Make sure to hide the spinner even in case of an error
        document.getElementById('news-loading').style.display = 'none';
        document.getElementById('newsHeadlines').style.display = 'block';
        
        const newsContainer = document.getElementById('newsHeadlines');
        if (newsContainer) {
            newsContainer.innerHTML = '<p><em>Error loading headlines</em></p>';
        }
    }

    updatingNews = false;
}

// Set visibility of the share buttons based on settings
export function setShareButtonsVisibility() {
    const shareButtons = document.querySelectorAll('.share-icon');
    shareButtons.forEach(button => {
        if (settings["news-forwarding"]) {
            button.style.display = 'block';
        } else {
            button.style.display = 'none';
        }
    });
}

// Updates all news timestamp displays on the page
export function updateNewsTimeDisplays() {
    const timeElements = document.querySelectorAll('.news-time[data-timestamp]');
    timeElements.forEach(element => {
        const timestamp = parseInt(element.getAttribute('data-timestamp'));
        if (!isNaN(timestamp)) {
            element.textContent = generateTimeAgoText(timestamp);
        }
    });
}

// Start the interval that updates time ago displays
export function startNewsTimeUpdates() {
    console.log('Starting news time updates');
    // Clear any existing interval first
    if (newsTimeUpdateInterval) {
        clearInterval(newsTimeUpdateInterval);
    }
    // Update immediately
    updateNewsTimeDisplays();
    // Then set up interval to update every second
    newsTimeUpdateInterval = setInterval(updateNewsTimeDisplays, 5000);
}

// Stop the interval that updates time ago displays
export function stopNewsTimeUpdates() {
    console.log('Stopping news time updates');
    if (newsTimeUpdateInterval) {
        clearInterval(newsTimeUpdateInterval);
        newsTimeUpdateInterval = null;
    }
}

// Mark all current news items as read
export async function markAllNewsAsRead() {
    console.log('Marking all news as read');
    
    // Disconnect observer temporarily
    if (newsObserver) {
        newsObserver.disconnect();
    }
    
    // Clear pending items set
    pendingReadItems.clear();
    
    // Find all visible news items and mark them as read
    const newsItems = document.querySelectorAll('.news-item');
    if (newsItems.length) {
        // Collect all IDs first
        const ids = [];
        newsItems.forEach(element => {
            const id = element.getAttribute('data-id');
            if (id) {
                ids.push(id);
            }
        });
        
        // Mark all as read in parallel
        const markPromises = ids.map(id => markNewsSeen(id));
        await Promise.all(markPromises);
        
        // Update UI for all items
        newsItems.forEach(element => {
            const timeElement = element.querySelector('.news-time');
            if (timeElement) {
                timeElement.classList.add('news-seen-transition');
                
                // After a brief delay, remove the new-time class
                setTimeout(() => {
                    timeElement.classList.remove('news-new-time');
                    timeElement.classList.remove('news-seen-transition');
                }, 500); // Shorter delay for marking all as read
            }
        });
    }
    
    // Update notification dot since we've marked all as read
    setTimeout(() => {
        updateNewsNotificationDot();
    }, 600);
    
    // Reconnect observer after a delay to allow transitions to complete
    setTimeout(setupNewsObserver, 600);
}

// Utility function to generate "time ago" text from a timestamp
function generateTimeAgoText(timestamp) {
    const now = new Date();
    const itemDate = new Date(timestamp * 1000);
    const timeDifference = Math.floor((now - itemDate) / 1000); // Difference in seconds

    if (timeDifference < 60) {
        return `${timeDifference} seconds ago`;
    } else if (timeDifference < 7200) {
        const minutes = Math.floor(timeDifference / 60);
        return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    } else if (timeDifference < 86400) {
        const hours = Math.floor(timeDifference / 3600);
        return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    } else {
        const days = Math.floor(timeDifference / 86400);
        const remainingSeconds = timeDifference % 86400;
        const hours = Math.floor(remainingSeconds / 3600);
        return `${days} day${days > 1 ? 's' : ''} and ${hours} hour${hours > 1 ? 's' : ''} ago`;
    }
}

// Generate unique IDs for news items
function genItemID(item)
{
    // Combine all relevant item properties into a single string,
    // excluding the date to avoid getting fooled by minor updates
    const dataToHash = `${item.source}${item.title}`;
    
    // Generate a hash - first convert string to a numerical hash
    let hash = 0;
    for (let i = 0; i < dataToHash.length; i++) {
        const char = dataToHash.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    
    // Convert numerical hash to a 16-character hexadecimal string
    // Use absolute value to handle negative numbers
    let hexHash = Math.abs(hash).toString(16);
    
    // If longer than 16 chars, truncate
    if (hexHash.length > 16) {
        hexHash = hexHash.substring(0, 16);
    }
    
    return hexHash;
}

// Take news item and generate HTML
function generateHTMLforItem(item)
{
    // Determine if the timestamp should have the news-new-time class
    let timeClass = item.isUnread ? 'news-time news-new-time' : 'news-time';

    // Extract domain for favicon either from the item.icon or from item.link if available
    let faviconUrl = '';
    if (item.icon && typeof item.icon === 'string' && item.icon.trim() !== '') {
        // Use the domain from the icon key
        faviconUrl = `https://www.google.com/s2/favicons?domain=${item.icon}&sz=32`;
    } else {
        try {
            const url = new URL(item.link);
            faviconUrl = `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=32`;
        } catch (e) {
            console.error('Error parsing URL for favicon:', e);
        }
    }

    return `
        <div class="news-item" data-id="${item.id}" onclick="clickNews('${item.title}','${item.link}','${item.source}','${item.id}')">
            <img src="${faviconUrl}" class="news-favicon" onerror="this.style.display='none'">
            <div>
                <span class="news-source">${item.source.toUpperCase()}</span>
                <span class="${timeClass}" data-timestamp="${item.date}">${generateTimeAgoText(item.date)}</span>
            </div>
            <div class="news-title">${item.title}</div>
            <button class="share-icon" onclick="shareNews('${item.title}','${item.link}','${item.source}','${item.id}'); event.stopPropagation();">
                <img src="assets/share.svg">
            </button>
        </div>`;
}

// Function to set up intersection observer for news items
export function setupNewsObserver() {
    // Disconnect any existing observer
    if (newsObserver) {
        newsObserver.disconnect();
    }
    
    // Clear any pending items
    pendingReadItems.clear();
    
    // Create new intersection observer
    newsObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const newsItem = entry.target;
            const id = newsItem.getAttribute('data-id');
            const timeElement = newsItem.querySelector('.news-time');
            
            if (!id || !timeElement) return;
            
            // If the item is visible (intersecting)
            if (entry.isIntersecting) {
                // Only track unread items
                if (timeElement.classList.contains('news-new-time')) {
                    // Add to pending set (don't mark as read yet)
                    pendingReadItems.add(id);
                    //console.log(`News item now visible, added to pending: ${id} (Total pending: ${pendingReadItems.size})`);
                }
            } 
            // Item is no longer visible
            else {
                // If it was in our pending set, now mark it as read
                if (pendingReadItems.has(id) && timeElement.classList.contains('news-new-time')) {
                    console.log(`News item scrolled out of view, marking as read: ${id}`);
                    // Mark as seen in ${RESTDB_URL}
                    markNewsSeen(id).then(() => {
                        // Remove from pending set
                        pendingReadItems.delete(id);
                    }).catch(error => {
                        console.error('Error marking news as read:', error);
                    });
                    
                    // Add transition class for smooth fade out
                    timeElement.classList.add('news-seen-transition');
                    
                    // After transition completes, remove the new-time class
                    setTimeout(() => {
                        timeElement.classList.remove('news-new-time');
                        timeElement.classList.remove('news-seen-transition');
                        
                        // Update notification dot after marking item as read
                        updateNewsNotificationDot();
                    }, 1500); // Match this to the CSS transition time
                }
            }
        });
    }, {
        root: null, // Use viewport as root
        rootMargin: '0px',
        threshold: 0.7 // Item must be 70% visible to count as "readPending"
    });
    
    // Observe all news items
    document.querySelectorAll('.news-item').forEach(item => {
        newsObserver.observe(item);
    });
    
    console.log('News observer set up, watching for visible news items');
    
    // Immediately (and asynchronously) identify initially visible unread items
    setTimeout(() => {
        // Use a different method to find initially visible items
        // since IntersectionObserver might not fire immediately
        const newsSection = document.getElementById('news');
        if (newsSection && window.getComputedStyle(newsSection).display === 'block') {
            const items = document.querySelectorAll('.news-item');
            let initiallyVisibleCount = 0;
            
            items.forEach(item => {
                const id = item.getAttribute('data-id');
                const timeElement = item.querySelector('.news-time');
                
                if (!id || !timeElement || !timeElement.classList.contains('news-new-time')) return;
                
                const rect = item.getBoundingClientRect();
                const isVisible = 
                    rect.top >= 0 &&
                    rect.left >= 0 &&
                    rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
                    rect.right <= (window.innerWidth || document.documentElement.clientWidth);
                
                if (isVisible) {
                    pendingReadItems.add(id);
                    initiallyVisibleCount++;
                }
            });
            
            if (initiallyVisibleCount > 0) {
                console.log(`Identified ${initiallyVisibleCount} initially visible unread items (Total pending: ${pendingReadItems.size})`);
            }
        }
    }, 100);
}

// Clean up resources when leaving the news section
export function cleanupNewsObserver() {
    // Mark all pending items as seen when leaving the news section
    if (pendingReadItems.size > 0) {
        console.log(`Marking ${pendingReadItems.size} news items as seen on section exit`);
        console.log('Pending items:', Array.from(pendingReadItems));
        
        // Create a copy of the pending items to process
        const itemsToProcess = Array.from(pendingReadItems);
        
        // Mark each pending item as seen using promises to ensure completion
        const markPromises = itemsToProcess.map(id => {
            return new Promise(async (resolve) => {
                console.log(`Processing pending item: ${id}`);
                
                try {
                    // Mark the news item as seen
                    await markNewsSeen(id);
                    
                    // Update the UI element if it exists
                    const timeElement = document.querySelector(`.news-item[data-id="${id}"] .news-time`);
                    if (timeElement) {
                        timeElement.classList.add('news-seen-transition');
                        timeElement.classList.remove('news-new-time');
                    }
                    
                    console.log(`Successfully marked item as seen: ${id}`);
                } catch (error) {
                    console.error(`Error marking item ${id} as seen:`, error);
                }
                
                // Remove from the pending set
                pendingReadItems.delete(id);
                resolve();
            });
        });
        
        // Wait for all items to be processed
        Promise.all(markPromises).then(() => {
            console.log('All pending items have been processed');
            // Make sure to update the notification dot after all items are processed
            updateNewsNotificationDot();
        });
    } else {
        console.log('No pending items to mark as seen');
    }
    
    // Disconnect the observer
    if (newsObserver) {
        console.log('Disconnecting news observer');
        newsObserver.disconnect();
        newsObserver = null;
    }
    
    // Make sure to update the notification dot before leaving
    updateNewsNotificationDot();
}

// Function to check if there are any unread news items and update notification dot
export function updateNewsNotificationDot() {
    // Check if there are any unread news items in the DOM
    const unreadItems = document.querySelectorAll('.news-time.news-new-time');
    const unreadCount = unreadItems.length;
    const hasUnread = unreadCount > 0;
    
    // Update our tracking variable
    hasUnreadNewsItems = hasUnread;
    
    // Get the news section button
    const newsButton = document.getElementById('news-section');
    if (!newsButton) return;
    
    // Update notification counter based on unread status
    if (hasUnread) {
        // Remove transition class if it's being shown again
        newsButton.classList.remove('notification-transition');
        
        // Small delay before showing to ensure transition works if toggled rapidly
        setTimeout(() => {
            newsButton.classList.add('has-notification');
            // Set the data-count attribute for CSS to use as content
            newsButton.setAttribute('data-count', unreadCount);
            console.log(`News notification counter updated (${unreadCount} unread items)`);
        }, 50);
    } else {
        if (newsButton.classList.contains('has-notification')) {
            // Add transition class to trigger fade-out
            newsButton.classList.add('notification-transition');
            
            // Let the fade-out animation complete before removing the class
            setTimeout(() => {
                newsButton.classList.remove('has-notification');
                newsButton.removeAttribute('data-count');
                newsButton.classList.remove('notification-transition');
                console.log('News notification counter removed (no unread items)');
            }, 600); // Should match the CSS transition time + small buffer
        }
    }
}

// User clicks on a news item
window.clickNews = async function (title, link, source, id) {
    // Mark the news item as read when clicked
    if (id) {
        // Remove from pending items if it was there
        pendingReadItems.delete(id);
        
        // Mark as read in ${RESTDB_URL}
        await markNewsSeen(id);
        
        // Update the UI - add transition and remove "new" styling
        const element = document.querySelector(`.news-item[data-id="${id}"]`);
        if (element) {
            const timeElement = element.querySelector('.news-time');
            if (timeElement && timeElement.classList.contains('news-new-time')) {
                // Add transition class first
                timeElement.classList.add('news-seen-transition');
                
                // Let the transition start before loading the URL
                setTimeout(() => {
                    timeElement.classList.remove('news-new-time');
                    // The transition class will remain during navigation but that's OK
                    
                    // Update notification dot status after marking item as read
                    updateNewsNotificationDot();
                }, 100);
            }
        }
    }
    
    if (settings["news-forward-only"] && isDriving) {
        await shareNews(title, link, source);
    }
    else {
        // Slight delay to allow the transition to be visible before loading URL
        setTimeout(() => {
            loadExternalUrl(link);
        }, 200);
    }
}

// User clicks on the share button
window.shareNews = async function (title, link, source, id) {
    console.log('Sharing news item:', title, link);

    // Mark the news item as read when shared
    if (id) {
        // Remove from pending items if it was there
        pendingReadItems.delete(id);
        
        // Mark as read in ${RESTDB_URL}
        await markNewsSeen(id);
        
        // Update the UI - add transition and remove "new" styling
        const element = document.querySelector(`.news-item[data-id="${id}"]`);
        if (element) {
            const timeElement = element.querySelector('.news-time');
            if (timeElement && timeElement.classList.contains('news-new-time')) {
                // Add transition class first
                timeElement.classList.add('news-seen-transition');
                
                // After transition completes, remove the new-time class
                setTimeout(() => {
                    timeElement.classList.remove('news-new-time');
                    timeElement.classList.remove('news-seen-transition');
                    
                    // Update notification dot after marking item as read
                    updateNewsNotificationDot();
                }, 1500); // Match this to the CSS transition time
            }
        }
    }

    // E-mail address to share with
    if (settings["forwarding-email"] === '') {
        return;
    }
    const to = settings["forwarding-email"];

    // Compose HTML payload
    const html = `
        <p>${source}</p>
        <a href="${link}">${title}</a>
        <br><br>
        <p>Sent from <a href="https://teslas.cloud">teslas.cloud</a></p>
    `;

    // Create the subject line
    const subject = `[teslas.cloud] ${title}`;

    // Communicate with the forwarding server
    try {
        const response = await fetch('share.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to, html, subject })
        });
        if (response.ok) {
            const alertBox = document.createElement('div');
            alertBox.textContent = 'Article shared successfully';
            alertBox.style.position = 'fixed';
            alertBox.style.top = '20px';
            alertBox.style.left = '50%';
            alertBox.style.transform = 'translateX(-50%)';
            alertBox.style.backgroundColor = "rgb(15, 181, 21) ";
            alertBox.style.color = 'white';
            alertBox.style.padding = '15px';
            alertBox.style.borderRadius = '5px';
            alertBox.style.boxShadow = '0 2px 5px rgba(0, 0, 0, 0.3)';
            alertBox.style.zIndex = '9999';
            document.body.appendChild(alertBox);

            setTimeout(() => {
                document.body.removeChild(alertBox);
            }, 5000);
        } else {
            const errorText = await response.text();
            alert('Failed to share article: ' + errorText);
        }
    } catch (err) {
        alert('Error sharing article: ' + err);
    }
}

// Pauses the automatic news updates
window.pauseNewsUpdates = function () {
    if (newsUpdateInterval) {
        clearInterval(newsUpdateInterval);
        newsUpdateInterval = null;
        console.log('News updates paused');
    }
}

// Resumes the automatic news updates if paused
window.resumeNewsUpdates = function () {
    if (!newsUpdateInterval) {
        updateNews(); // Call immediately
        newsUpdateInterval = setInterval(updateNews, 60000 * NEWS_REFRESH_INTERVAL);
        console.log('News updates resumed');
    }
}

// Debug function to check ${RESTDB_URL} news data
window.checkSeenNewsStorage = async function() {
    const seenIds = await getSeenNewsIds();
    const count = Object.keys(seenIds).length;
    
    let oldestTimestamp = Date.now();
    if (Object.keys(seenIds).length > 0) {
        oldestTimestamp = Math.min(...Object.values(seenIds));
    }
    const oldestDate = new Date(oldestTimestamp);
    
    console.log(`Seen news items in restdb: ${count}`);
    console.log(`Oldest item from: ${oldestDate.toLocaleString()}`);
    console.log('Sample items:', Object.keys(seenIds).slice(0, 5));
    
    return {
        count,
        oldest: oldestDate,
        sample: Object.keys(seenIds).slice(0, 5)
    };
}

// Clear all seen news data from ${RESTDB_URL}
window.clearSeenNewsStorage = async function() {
    // Only perform if user is logged in
    if (!isLoggedIn || !hashedUser) {
        console.log('User not logged in, nothing to clear');
        return false;
    }
    
    try {
        // Get all article IDs
        const seenIds = await getSeenNewsIds();
        
        // Delete each article ID
        const deletePromises = Object.keys(seenIds).map(id => {
            return fetch(`${RESTDB_URL}/${hashedUser}/${id}`, {
                method: 'DELETE'
            });
        });
        
        await Promise.all(deletePromises);
        
        // Clear the cache
        cachedSeenNewsIds = {};
        
        console.log('Cleared all seen news data from rest_db.php');
        return true;
    } catch (error) {
        console.error('Error clearing seen news data:', error);
        return false;
    }
}

// Debug function to check pending items
window.checkPendingNewsItems = function() {
    console.log(`Currently pending read items: ${pendingReadItems.size}`);
    console.log('Pending IDs:', Array.from(pendingReadItems));
    return Array.from(pendingReadItems);
}
