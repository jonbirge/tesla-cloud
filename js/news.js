// Imports
import { settings, isDriving } from './settings.js';
import { showSpinner, hideSpinner, showNotification } from './common.js';

// Constants
const NEWS_REFRESH_INTERVAL = 5; // minutes
const SEEN_NEWS_STORAGE_KEY = 'seenNewsIds'; // localStorage key for seen news IDs
const MAX_AGE_DAYS = 2; // Maximum age in days for seen news IDs

// Variables
let newsUpdateInterval = null;
let newsTimeUpdateInterval = null; // Interval for updating "time ago" displays
let newsObserver = null; // Intersection Observer for tracking visible news items
let pendingReadItems = new Set(); // Track items that are currently visible but not yet marked as read
let hasUnreadNewsItems = false; // Track if there are any unread news items

// Helper functions for localStorage management
function getSeenNewsIds() {
    const storedData = localStorage.getItem(SEEN_NEWS_STORAGE_KEY);
    if (!storedData) {
        return {};
    }
    try {
        return JSON.parse(storedData);
    } catch (error) {
        console.error('Error parsing seen news IDs from localStorage:', error);
        return {};
    }
}

function saveSeenNewsIds(seenIds) {
    try {
        // Clean up old entries (older than MAX_AGE_DAYS)
        const now = Date.now();
        const cleanedIds = {};
        
        Object.entries(seenIds).forEach(([id, timestamp]) => {
            const ageInDays = (now - timestamp) / (1000 * 60 * 60 * 24);
            if (ageInDays < MAX_AGE_DAYS) {
                cleanedIds[id] = timestamp;
            }
        });
        
        localStorage.setItem(SEEN_NEWS_STORAGE_KEY, JSON.stringify(cleanedIds));
    } catch (error) {
        console.error('Error saving seen news IDs to localStorage:', error);
    }
}

function markNewsSeen(id) {
    const seenIds = getSeenNewsIds();
    seenIds[id] = Date.now();
    saveSeenNewsIds(seenIds);
}

function isNewsSeen(id) {
    const seenIds = getSeenNewsIds();
    return id in seenIds;
}

// Updates the news headlines, optionally clearing existing ones
export async function updateNews(clear = false) {
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
        
        // Allows for adding options to the URL for future use
        const baseUrl = 'rss.php?n=128';
        
        // Get the news container element
        const newsContainer = document.getElementById('newsHeadlines');
        if (!newsContainer) return;

        // Clear the news container as needed
        if (clear) {
            console.log('Clearing news headlines...');
            newsContainer.innerHTML = '';
        }

        // Show loading spinner if no items are displayed yet or only showing a message
        const isEmpty = !newsContainer.innerHTML || 
                       newsContainer.innerHTML.includes('<em>') || 
                       newsContainer.innerHTML.trim() === '';
        
        if (isEmpty) {
            // Show the static spinner instead of creating one dynamically
            document.getElementById('news-loading').style.display = 'flex';
            newsContainer.style.display = 'none';
        }
        
        console.log('Fetching news headlines...');
        if (includedFeeds.length > 0) {
            console.log('Including RSS feeds:', includedFeeds);
        } else {
            console.log('No RSS feeds selected, showing all available feeds');
        }
        
        // Send the request with included feeds in the body
        const response = await fetch(baseUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ includedFeeds })
        });
        const loadedItems = await response.json();
        
        // Hide the spinner when data arrives
        document.getElementById('news-loading').style.display = 'none';
        newsContainer.style.display = 'block';
        
        // Track if we have new items
        let hasNewItems = false;
        
        if (loadedItems.length > 0) {
            // Generate unique IDs for each news item and check against localStorage
            loadedItems.forEach(item => {
                // Create a unique ID based on title and source
                item.id = genItemID(item);
                
                // Check if this is a new item using localStorage
                item.isUnread = !isNewsSeen(item.id);
                
                // Track if we have new items but don't mark them as seen yet
                // They'll be marked as seen when they become visible via the observer
                if (item.isUnread) {
                    hasNewItems = true;
                }
            });
            
            // If we have new items, update notification dot
            if (hasNewItems) {
                // Add notification dot if news section is not currently displayed
                const newsSection = document.getElementById('news');
                if (newsSection && newsSection.style.display !== 'block') {
                    const newsButton = document.querySelector('.section-button[onclick="showSection(\'news\')"]');
                    if (newsButton) {
                        newsButton.classList.add('has-notification');
                    }
                }
            }
        }

        // Sort items by date - newest first
        loadedItems.sort((a, b) => b.date - a.date);

        // Update the news container with the new items
        if (loadedItems.length > 0) {
            newsContainer.innerHTML = loadedItems.map(generateHTMLforItem).join('');
            
            // Set up the observer to track visible news items
            setupNewsObserver();
            
            // Update notification dot status based on unread items
            updateNewsNotificationDot();
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

    // Update the visibility of share buttons
    setShareButtonsVisibility();
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
export function markAllNewsAsRead() {
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
        newsItems.forEach(element => {
            const id = element.getAttribute('data-id');
            if (id) {
                // Mark as read in localStorage
                markNewsSeen(id);
                
                // Update UI - remove "new" styling from time elements
                const timeElement = element.querySelector('.news-time');
                if (timeElement) {
                    timeElement.classList.add('news-seen-transition');
                    
                    // After a brief delay, remove the new-time class
                    setTimeout(() => {
                        timeElement.classList.remove('news-new-time');
                        timeElement.classList.remove('news-seen-transition');
                    }, 500); // Shorter delay for marking all as read
                }
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
    return `${item.source}-${item.title.substring(0, 40)}`;
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
            <button class="share-icon" onclick="shareNews('${item.title}','${item.link}','${item.source}'); event.stopPropagation();">
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
                }
            } 
            // Item is no longer visible
            else {
                // If it was in our pending set, now mark it as read
                if (pendingReadItems.has(id) && timeElement.classList.contains('news-new-time')) {
                    console.log(`News item scrolled out of view, marking as read: ${id}`);
                    // Mark as seen in localStorage
                    markNewsSeen(id);
                    
                    // Remove from pending set
                    pendingReadItems.delete(id);
                    
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
}

// Clean up resources when leaving the news section
export function cleanupNewsObserver() {
    // We no longer mark items as read when leaving the section,
    // but we still need to clean up the observer
    
    // Just clear the pending set without marking items as read
    if (pendingReadItems.size > 0) {
        console.log(`Preserving unread status for ${pendingReadItems.size} news items on section exit`);
        pendingReadItems.clear();
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

// User clicks on a news item
window.clickNews = async function (title, link, source, id) {
    // Mark the news item as read when clicked
    if (id) {
        // Remove from pending items if it was there
        pendingReadItems.delete(id);
        
        // Mark as read directly in localStorage
        markNewsSeen(id);
        
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
window.shareNews = async function (title, link, source) {
    console.log('Sharing news item:', title, link);

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

// Debug function to check localStorage news data
window.checkSeenNewsStorage = function() {
    const seenIds = getSeenNewsIds();
    const count = Object.keys(seenIds).length;
    const oldestTimestamp = Math.min(...Object.values(seenIds));
    const oldestDate = new Date(oldestTimestamp);
    
    console.log(`Seen news items in storage: ${count}`);
    console.log(`Oldest item from: ${oldestDate.toLocaleString()}`);
    console.log('Sample items:', Object.keys(seenIds).slice(0, 5));
    
    return {
        count,
        oldest: oldestDate,
        sample: Object.keys(seenIds).slice(0, 5)
    };
}

// Clear all seen news data from localStorage
window.clearSeenNewsStorage = function() {
    localStorage.removeItem(SEEN_NEWS_STORAGE_KEY);
    console.log('Cleared all seen news data from localStorage');
    return true;
}

// Debug function to check pending items
window.checkPendingNewsItems = function() {
    console.log(`Currently pending read items: ${pendingReadItems.size}`);
    console.log('Pending IDs:', Array.from(pendingReadItems));
    return Array.from(pendingReadItems);
}

// Function to check if there are any unread news items and update notification dot
export function updateNewsNotificationDot() {
    // Check if there are any unread news items in the DOM
    const unreadItems = document.querySelectorAll('.news-time.news-new-time');
    const hasUnread = unreadItems.length > 0;
    
    // Update our tracking variable
    hasUnreadNewsItems = hasUnread;
    
    // Get the news section button
    const newsButton = document.querySelector('.section-button[onclick="showSection(\'news\')"]');
    if (!newsButton) return;
    
    // Update notification dot based on unread status
    if (hasUnread) {
        newsButton.classList.add('has-notification');
        console.log(`News notification dot added (${unreadItems.length} unread items)`);
    } else {
        newsButton.classList.remove('has-notification');
        console.log('News notification dot removed (no unread items)');
    }
}
