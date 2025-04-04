// Imports
import { customLog, formatTime } from './common.js';
import { settings } from './settings.js';

// Constants
const NEWS_REFRESH_INTERVAL = 5; // minutes

// Variables
let newsItems = null; // Current array of news items
let newsUpdateInterval = null;
let seenNewsIds = new Set(); // Track news IDs we've already seen

// Mark all current news items as read
export function markAllNewsAsRead() {
    if (newsItems) {
        newsItems.forEach(item => {
            item.isUnread = false;
        });
    }
}

// Updates the news headlines, optionally clearing existing ones
export async function updateNews(clear = false) {
    try {
        // Collect excluded RSS feeds from user settings
        const excludedFeeds = [];
        if (settings) {
            // Collect all RSS feed settings that are set to false
            for (const key in settings) {
                if (key.startsWith('rss-') && settings[key] === false) {
                    // Extract feed ID after the "rss-" prefix
                    const feedId = key.substring(4);
                    excludedFeeds.push(feedId);
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
            newsContainer.innerHTML = '';
            seenNewsIds.clear(); // Clear seen news IDs
            newsItems = null; // Clear news items
        }

        // Show loading spinner if no items are displayed yet or only showing a message
        const isEmpty = !newsContainer.innerHTML || 
                       newsContainer.innerHTML.includes('<em>') || 
                       newsContainer.innerHTML.trim() === '';
        
        if (isEmpty) {
            newsContainer.innerHTML = '<div class="spinner-container"><div class="spinner"></div></div>';
        }
        
        customLog('Updating news headlines...');
        if (excludedFeeds.length > 0) {
            customLog('Excluding RSS feeds:', excludedFeeds);
        }
        
        // Send the request with excluded feeds in the body
        const response = await fetch(baseUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ excludedFeeds })
        });
        const loadedItems = await response.json();
        
        // Remove the spinner when data arrives
        const spinnerContainer = newsContainer.querySelector('.spinner-container');
        if (spinnerContainer) {
            spinnerContainer.remove();
        }
        
        // Create list of new items
        let hasNewItems = false;
        const newItems = [];
        if (loadedItems.length > 0) {
            // Generate unique IDs for each news item 
            loadedItems.forEach(item => {
                // Create a unique ID based on title and source
                item.id = genItemID(item);
                
                // Check if this is a new item
                if (!seenNewsIds.has(item.id)) {
                    item.isUnread = true; // Mark as unread
                    hasNewItems = true;
                    newItems.push(item);
                    seenNewsIds.add(item.id);
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

        // Merge new items with existing ones
        if (newsItems) {
            newsItems = [...newItems, ...newsItems];
        } else {
            newsItems = newItems;
        }

        // Sort items by date
        newsItems.sort((a, b) => b.date - a.date);

        // Update the news container with the new items
        if (newsItems.length > 0) {
            newsContainer.innerHTML = newsItems.map(generateHTMLforItem).join('');
        } else {
            newsContainer.innerHTML = '<p><em>No headlines available</em></p>';
        }
    } catch (error) {
        console.error('Error fetching news:', error);
        customLog('Error fetching news:', error);
        
        const newsContainer = document.getElementById('newsHeadlines');
        // Make sure to remove the spinner even in case of an error
        if (newsContainer) {
            const spinnerContainer = newsContainer.querySelector('.spinner-container');
            if (spinnerContainer) {
                spinnerContainer.remove();
            }
            newsContainer.innerHTML = '<p><em>Error loading headlines</em></p>';
        }
    }
}

// Generate unique IDs for news items
function genItemID(item)
{
    // Create a unique ID based on title and source
    return `${item.source}-${item.title.substring(0, 40)}`;
}

// Takes news item and generates HTML for it
function generateHTMLforItem(item)
{
    const date = new Date(item.date * 1000);
    const dateString = date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric'
    });
    const timeString = formatTime(date, { 
        timeZoneName: 'short'
    });
    
    // Extract domain for favicon
    // TODO: Cache favicon URLs to avoid repeated requests
    let faviconUrl = '';
    try {
        const url = new URL(item.link);
        faviconUrl = `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=32`;
    } catch (e) {
        console.error('Error parsing URL for favicon:', e);
    }

    // If the item is unread, add a class to highlight it
    let classList = null;
    if (item.isUnread) {
        classList = 'news-item news-new';
    } else {
        classList = 'news-item';
    }

    return `
        <button class="${classList}" data-id="${item.id}" onclick="loadExternalUrl('${item.link}')">
            <img src="${faviconUrl}" class="news-favicon" onerror="this.style.display='none'">
            <div>
                <span class="news-source">${item.source.toUpperCase()}</span>
                <span class="news-date">${dateString}</span>
                <span class="news-time">${timeString}</span>
            </div>
            <div class="news-title">${item.title}</div>
        </button>`;
}

// Pauses the automatic news updates
window.pauseNewsUpdates = function () {
    if (newsUpdateInterval) {
        clearInterval(newsUpdateInterval);
        newsUpdateInterval = null;
        customLog('News updates paused');
    }
}

// Resumes the automatic news updates if paused
window.resumeNewsUpdates = function () {
    if (!newsUpdateInterval) {
        updateNews(); // Call immediately
        newsUpdateInterval = setInterval(updateNews, 60000 * NEWS_REFRESH_INTERVAL);
        customLog('News updates resumed');
    }
}
