// Imports
import { customLog, testMode, formatTime } from './common.js';
import { settings, currentUser } from './settings.js';

// Constants
const NEWS_REFRESH_INTERVAL = 2.5; // minutes

// Variables
let newsUpdateInterval = null;
let lastNewsTimestamp = 0; // Track the latest news timestamp we've seen
let userHasSeenLatestNews = true; // Track if the user has seen the latest news
let seenNewsIds = new Set(); // Track news IDs we've already seen

// Exports
export { userHasSeenLatestNews };

export function setUserHasSeenLatestNews(value) {
    userHasSeenLatestNews = value;
}

export async function updateNews(clear = false) {
    try {
        // Collect excluded RSS feeds from user settings
        const excludedFeeds = [];
        if (currentUser && settings) {
            // Collect all RSS feed settings that are set to false
            for (const key in settings) {
                if (key.startsWith('rss-') && settings[key] === false) {
                    // Extract feed ID after the "rss-" prefix
                    const feedId = key.substring(4);
                    excludedFeeds.push(feedId);
                }
            }
        }
        
        // Use test parameter when in test mode
        const baseUrl = testMode ? 'rss.php?test' : 'rss.php';
        
        // Get the news container element
        const newsContainer = document.getElementById('newsHeadlines');
        if (!newsContainer) return;

        // Clear the news container if requested
        if (clear) {
            newsContainer.innerHTML = '';
            lastNewsTimestamp = 0; // Reset last news timestamp
            seenNewsIds.clear(); // Clear seen news IDs
            userHasSeenLatestNews = true; // Reset user seen status
        }
        // TODO: Differentiate between loaded news and read news...

        // Show loading spinner if no items are displayed yet or only showing a message
        const isEmpty = !newsContainer.innerHTML || 
                       newsContainer.innerHTML.includes('<em>') || 
                       newsContainer.innerHTML.trim() === '';
        
        if (isEmpty) {
            newsContainer.innerHTML = '<div class="spinner-container"><div class="spinner"></div></div>';
        }
        
        customLog('Updating news headlines...' + (testMode ? ' (TEST MODE)' : ''));
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
        
        const items = await response.json();
        
        // Make sure to remove the spinner when data arrives
        const spinnerContainer = newsContainer.querySelector('.spinner-container');
        if (spinnerContainer) {
            spinnerContainer.remove();
        }
        
        // Filter for new items only
        let hasNewItems = false;
        const newItems = [];
        
        if (items.length > 0) {
            // Generate unique IDs for each news item 
            items.forEach(item => {
                // Create a unique ID based on title and source
                const itemId = `${item.source}-${item.title.substring(0, 40)}`;
                item.id = itemId;
                
                // Check if this is a new item
                if (!seenNewsIds.has(itemId)) {
                    hasNewItems = true;
                    newItems.push(item);
                    seenNewsIds.add(itemId);
                }
            });
            
            // If we have new items, update notification and add to container
            if (hasNewItems) {
                const newestTimestamp = Math.max(...items.map(item => item.date));
                if (newestTimestamp > lastNewsTimestamp) {
                    lastNewsTimestamp = newestTimestamp;
                    userHasSeenLatestNews = false;
                    
                    // Only add notification dot if news section is not currently displayed
                    const newsSection = document.getElementById('news');
                    if (newsSection && newsSection.style.display !== 'block') {
                        const newsButton = document.querySelector('.section-button[onclick="showSection(\'news\')"]');
                        if (newsButton) {
                            newsButton.classList.add('has-notification');
                        }
                    }
                }
                
                // Create HTML for new items with blue dot indicator
                let newItemsHtml = newItems.map(item => {
                    const date = new Date(item.date * 1000);
                    const dateString = date.toLocaleDateString('en-US', { 
                        month: 'short', 
                        day: 'numeric'
                    });
                    const timeString = formatTime(date, { 
                        timeZoneName: 'short'
                    });
                    
                    // Extract domain for favicon
                    let faviconUrl = '';
                    try {
                        const url = new URL(item.link);
                        faviconUrl = `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=32`;
                    } catch (e) {
                        console.error('Error parsing URL for favicon:', e);
                    }
                    
                    return `
                        <button class="news-item news-new" data-id="${item.id}" onclick="loadExternalUrl('${item.link}')">
                            <img src="${faviconUrl}" class="news-favicon" onerror="this.style.display='none'">
                            <div>
                                <span class="news-source">${item.source.toUpperCase()}</span>
                                <span class="news-date">${dateString}</span>
                                <span class="news-time">${timeString}</span>
                            </div>
                            <div class="news-title">${item.title}</div>
                        </button>`;
                }).join('');
                
                // Prepend new items to existing content or initialize if empty
                if (newsContainer.innerHTML && !newsContainer.innerHTML.includes('<em>') && !newsContainer.innerHTML.includes('spinner-container')) {
                    newsContainer.innerHTML = newItemsHtml + newsContainer.innerHTML;
                } else {
                    newsContainer.innerHTML = newItemsHtml || '<p><em>No headlines available</em></p>';
                }
            }
        }
        
        // If there were no new items and the container is empty or only contains a spinner, show a message
        if (!hasNewItems && (!newsContainer.innerHTML || 
                            newsContainer.innerHTML.includes('<em>') || 
                            newsContainer.innerHTML.includes('spinner-container'))) {
            newsContainer.innerHTML = '<p><em>No new headlines available</em></p>';
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

// Function to pause news updates
window.pauseNewsUpdates = function () {
    if (newsUpdateInterval) {
        clearInterval(newsUpdateInterval);
        newsUpdateInterval = null;
        customLog('News updates paused');
    }
}

// Function to resume news updates if they were active
window.resumeNewsUpdates = function () {
    if (!newsUpdateInterval) {
        updateNews(); // Call immediately
        // Set interval based on test mode
        if (testMode) {
            newsUpdateInterval = setInterval(updateNews, 15000);
        } else {
            newsUpdateInterval = setInterval(updateNews, 60000 * NEWS_REFRESH_INTERVAL);
        }
        customLog('News updates resumed');
    }
}
