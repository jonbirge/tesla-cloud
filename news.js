// Imports
import { settings } from './settings.js';

// Constants
const NEWS_REFRESH_INTERVAL = 5; // minutes

// Variables
let newsItems = null; // Current array of news items
let newsUpdateInterval = null;
let seenNewsIds = new Set(); // Track news IDs we've already seen
let newsTimeUpdateInterval = null; // Interval for updating "time ago" displays

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
        console.log('Error fetching news:', error);
        
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
    if (newsItems) {
        newsItems.forEach(item => {
            item.isUnread = false;
        });
    }
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
    // Create a unique ID based on title and source
    return `${item.source}-${item.title.substring(0, 40)}`;
}

// Takes news item and generates HTML for it
function generateHTMLforItem(item)
{
    // If the item is unread, add a class to highlight it
    let classList = null;
    if (item.isUnread) {
        classList = 'news-item news-new';
    } else {
        classList = 'news-item';
    }

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
        <div class="${classList}" data-id="${item.id}" onclick="clickNews('${item.title}','${item.link}','${item.source}')">
            <img src="${faviconUrl}" class="news-favicon" onerror="this.style.display='none'">
            <div>
                <span class="news-source">${item.source.toUpperCase()}</span>
                <span class="news-time" data-timestamp="${item.date}">${generateTimeAgoText(item.date)}</span>
            </div>
            <div class="news-title">${item.title}</div>
            <button class="share-icon" onclick="shareNews('${item.title}','${item.link}','${item.source}'); event.stopPropagation();">
                <img src="share.svg">
            </button>
        </div>`;
}

window.clickNews = async function (title, link, source) {
    if (settings["news-forward-only"]) {
        await shareNews(title, link, source);
    }
    else {
        loadExternalUrl(link);
    }
}

// Forwards the news item link to the share function
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
