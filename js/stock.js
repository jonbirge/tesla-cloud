// Configuration
const STOCK_API_ENDPOINT = 'quote.php?symbol='; // Prefix for internal stock REST API
const UPDATE_INTERVAL = 2 * 60 * 1000; // 2 minutes in milliseconds
const CACHE_AGE_LIMIT = 1 * 60 * 1000; // minute in milliseconds
const DISPLAY_ALTERNATE_INTERVAL = 5 * 1000; // 5 seconds in milliseconds

// Global variables
let stockUpdateTimer = null;
let displayAlternateTimer = null;
let stockDataCache = {}; // Cache object to store stock data by ticker
let showChange = true; // Flag to show change in stock price
let availableStocks = []; // List of available stocks from stocks.json
let availableIndexes = []; // List of available indexes from indexes.json

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

// Generate DOM elements for all stock indicators
function generateStockIndicatorElements() {
    const fragment = document.createDocumentFragment();
    const subscribedTickers = getSubscribedTickers();
    const masterEnabled = settings["show-stock-indicator"] !== false;

    if (!masterEnabled || subscribedTickers.length === 0) {
        return fragment; // Return empty fragment if disabled or no subscriptions
    }

    subscribedTickers.forEach(ticker => {
        const cached = stockDataCache[ticker.toUpperCase()];
        const displayData = getDisplayData(ticker, cached);

        const div = document.createElement('div');
        div.id = `stock-status-${ticker.toLowerCase()}`;
        div.className = `status-indicator stock-status ${displayData.className}`;

        div.appendChild(document.createTextNode(ticker.toUpperCase()));

        const arrowSpan = document.createElement('span');
        arrowSpan.id = 'stock-arrow';
        arrowSpan.textContent = displayData.arrow;
        div.appendChild(arrowSpan);

        const valueSpan = document.createElement('span');
        valueSpan.id = 'stock-value';
        valueSpan.textContent = displayData.value;
        div.appendChild(valueSpan);

        fragment.appendChild(div);
    });

    return fragment;
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
        // Check if this ticker is an index by looking it up in availableIndexes
        const isIndex = availableIndexes.some(index => index.TrackingETF === ticker.toUpperCase());
        
        if (isIndex && price) {
            // Find the coefficient for this index
            const indexData = availableIndexes.find(index => index.TrackingETF === ticker.toUpperCase());
            if (indexData && indexData.Coefficient) {
                // Calculate index value: ETF price * coefficient
                const indexValue = parseFloat(price) * parseFloat(indexData.Coefficient);
                value = indexValue.toFixed(2); // No dollar sign for indexes
            } else {
                value = '--';
            }
        } else if (price) {
            // Regular stock - show with dollar sign
            value = `$${parseFloat(price).toFixed(2)}`;
        } else {
            value = '--';
        }
    } else {
        value = Math.abs(percentChange).toFixed(2) + '%';
    }
    
    return { className, arrow, value };
}

// Update the stock indicators container with new HTML
function updateStockIndicatorsContainer() {
    const container = document.getElementById('stock-indicators');
    if (!container) return;
    
    container.replaceChildren();
    const elements = generateStockIndicatorElements();
    container.appendChild(elements);
}

// Initialize on load
loadStockAndIndexData();

// Function to start periodic updates
export function startStockUpdates() {
    updateStockIndicatorVisibility();

    const subscribedTickers = getSubscribedTickers();
    const anyEnabled = subscribedTickers.length > 0 && settings["show-stock-indicator"] !== false;

    if (anyEnabled) {
        // Start data fetching timer
        if (!stockUpdateTimer) {
            fetchStockData();
            stockUpdateTimer = setInterval(fetchStockData, UPDATE_INTERVAL);
        }
        
        // Start display alternating timer if the setting is enabled
        if (settings['show-price-alt'] && !displayAlternateTimer) {
            displayAlternateTimer = setInterval(() => {
                showChange = !showChange;
                updateStockIndicatorsContainer();
            }, DISPLAY_ALTERNATE_INTERVAL);
        }
    } else {
        // Stop both timers if disabled
        if (stockUpdateTimer) {
            clearInterval(stockUpdateTimer);
            stockUpdateTimer = null;
        }
        if (displayAlternateTimer) {
            clearInterval(displayAlternateTimer);
            displayAlternateTimer = null;
        }
    }
}

// Function to stop periodic updates
export function stopStockUpdates() {
    if (stockUpdateTimer) {
        clearInterval(stockUpdateTimer);
        stockUpdateTimer = null;
    }
    if (displayAlternateTimer) {
        clearInterval(displayAlternateTimer);
        displayAlternateTimer = null;
    }
    updateStockIndicatorVisibility();
}

// Function to start or stop the display alternating timer based on setting
function updateDisplayAlternating() {
    const shouldAlternate = settings['show-price-alt'] && 
                           getSubscribedTickers().length > 0 && 
                           settings["show-stock-indicator"] !== false;
    
    if (shouldAlternate && !displayAlternateTimer) {
        // Start alternating timer
        displayAlternateTimer = setInterval(() => {
            showChange = !showChange;
            updateStockIndicatorsContainer();
        }, DISPLAY_ALTERNATE_INTERVAL);
    } else if (!shouldAlternate && displayAlternateTimer) {
        // Stop alternating timer
        clearInterval(displayAlternateTimer);
        displayAlternateTimer = null;
        // Reset to showing percentage change
        showChange = true;
        updateStockIndicatorsContainer();
    }
}

// Function to fetch stock data for all indicators
export function fetchStockData() {
    console.log('Fetching financial data...');
    const currentTime = Date.now();

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
    updateDisplayAlternating();
}

// Function to update stock indicator visibility based on settings
export function updateStockIndicatorVisibility() {
    // Simply regenerate the entire container
    updateStockIndicatorsContainer();
    // Update display alternating based on current settings
    updateDisplayAlternating();
}
