// Configuration
const STOCK_API_ENDPOINT = 'quote.php?symbol='; // Prefix for internal stock REST API
const UPDATE_INTERVAL = 2 * 60 * 1000; // 2 minutes in milliseconds
const CACHE_AGE_LIMIT = 1 * 60 * 1000; // minute in milliseconds

// Global variables
let stockUpdateTimer = null;
let stockDataCache = {}; // Cache object to store stock data by ticker
let showChange = true; // Flag to show change in stock price
let availableStocks = [];
let availableIndexes = [];

// Import settings to check visibility setting
import { settings } from './settings.js';

// Load stock and index data
async function loadStockAndIndexData() {
    try {
        const [stocksResponse, indexesResponse] = await Promise.all([
            fetch('js/stocks.json'),
            fetch('js/indexes.json')
        ]);
        
        availableStocks = await stocksResponse.json();
        availableIndexes = await indexesResponse.json();
        
        console.log('Loaded stock and index data');
        updateStockIndicatorVisibility();
    } catch (error) {
        console.error('Error loading stock/index data:', error);
    }
}

// Get all subscribed tickers (stocks + indexes)
function getSubscribedTickers() {
    const subscribedStocks = settings['subscribed-stocks'] || [];
    const subscribedIndexes = settings['subscribed-indexes'] || [];
    return [...subscribedStocks, ...subscribedIndexes];
}

// Generate complete HTML for all stock indicators
function generateStockIndicatorsHTML() {
    const subscribedTickers = getSubscribedTickers();
    const masterEnabled = settings["show-stock-indicator"] !== false;
    
    if (!masterEnabled || subscribedTickers.length === 0) {
        return ''; // Return empty string if disabled or no subscriptions
    }
    
    return subscribedTickers.map(ticker => {
        const cached = stockDataCache[ticker.toUpperCase()];
        const displayData = getDisplayData(ticker, cached);
        
        return `
            <div id="stock-status-${ticker.toLowerCase()}" class="status-indicator stock-status ${displayData.className}">
                ${ticker.toUpperCase()}<span id="stock-arrow">${displayData.arrow}</span><span id="stock-value">${displayData.value}</span>
            </div>
        `;
    }).join('');
}

// Get display data for a ticker
function getDisplayData(ticker, cached) {
    if (!cached) {
        return {
            className: 'neutral',
            arrow: '--',
            value: '--%'
        };
    }
    
    const { percentChange, price } = cached;
    
    if (percentChange === null || percentChange === undefined) {
        return {
            className: 'neutral',
            arrow: '--',
            value: '--%'
        };
    }
    
    // Determine class and arrow based on percentage change
    let className, arrow;
    if (percentChange > 0) {
        className = 'up';
        arrow = '▲';
    } else if (percentChange < 0) {
        className = 'down';
        arrow = '▼';
    } else {
        className = 'neutral';
        arrow = '—';
    }
    
    // Determine value to display
    let value;
    if (settings['show-price-alt'] && !showChange) {
        value = price ? `$${parseFloat(price).toFixed(2)}` : '--';
    } else {
        value = Math.abs(percentChange).toFixed(2) + '%';
    }
    
    return { className, arrow, value };
}

// Update the stock indicators container with new HTML
function updateStockIndicatorsContainer() {
    const container = document.getElementById('stock-indicators');
    if (!container) return;
    
    container.innerHTML = generateStockIndicatorsHTML();
}

// Initialize on load
loadStockAndIndexData();

// Function to start periodic updates
export function startStockUpdates() {
    updateStockIndicatorVisibility();

    const subscribedTickers = getSubscribedTickers();
    const anyEnabled = subscribedTickers.length > 0 && settings["show-stock-indicator"] !== false;

    if (anyEnabled) {
        if (!stockUpdateTimer) {
            fetchStockData();
            stockUpdateTimer = setInterval(fetchStockData, UPDATE_INTERVAL);
        }
    } else {
        if (stockUpdateTimer) {
            clearInterval(stockUpdateTimer);
            stockUpdateTimer = null;
        }
    }
}

// Function to stop periodic updates
export function stopStockUpdates() {
    if (stockUpdateTimer) {
        clearInterval(stockUpdateTimer);
        stockUpdateTimer = null;
    }
    updateStockIndicatorVisibility();
}

// Function to fetch stock data for all indicators
export function fetchStockData() {
    console.log('Fetching financial data...');
    const currentTime = Date.now();

    if (settings['show-price-alt']) {
        showChange = !showChange; // Toggle before updating so cached data alternates
    }

    // Flag to indicate if US markets are open
    let usMarketsOpen;
    // Check if US markets are open (9:30 AM to 4:00 PM ET)
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 30);
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 16, 0);
    if (now >= startOfDay && now <= endOfDay) {
        usMarketsOpen = true;
    } else {
        usMarketsOpen = false;
    }
    
    const subscribedTickers = getSubscribedTickers();
    let pendingFetches = 0;
    
    // Process each subscribed ticker
    subscribedTickers.forEach(ticker => {
        const upperTicker = ticker.toUpperCase();
        
        // Check if we have valid cached data
        if (stockDataCache[upperTicker] && 
            (((currentTime - stockDataCache[upperTicker].timestamp) < CACHE_AGE_LIMIT) ||
            !usMarketsOpen)) {
            // Use cached data - no fetch needed
            return;
        }
        
        // Cache miss or expired, fetch fresh data
        console.log(`Fetching data for ${upperTicker}`);
        pendingFetches++;
        
        fetch(`${STOCK_API_ENDPOINT}${upperTicker}`)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Network response was not ok for ${upperTicker}`);
                }
                return response.json();
            })
            .then(data => {
                // Cache the data with current timestamp
                stockDataCache[upperTicker] = {
                    percentChange: data.percentChange,
                    price: data.price,
                    timestamp: Date.now()
                };
            })
            .catch(error => {
                console.error(`Error fetching stock data for ${upperTicker}:`, error);
                // Cache null data to show dashes
                stockDataCache[upperTicker] = {
                    percentChange: null,
                    price: null,
                    timestamp: Date.now()
                };
            })
            .finally(() => {
                pendingFetches--;
                // Update display when all fetches are complete or after each individual fetch
                updateStockIndicatorsContainer();
            });
    });
    
    // If no fetches were needed (all cached), still update display
    if (pendingFetches === 0) {
        updateStockIndicatorsContainer();
    }
}

export function setShowChange(value) {
    showChange = value;
}

// Function to update stock indicator visibility based on settings
export function updateStockIndicatorVisibility() {
    // Simply regenerate the entire container
    updateStockIndicatorsContainer();
}
