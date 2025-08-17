// Configuration
const STOCK_API_ENDPOINT = 'quote.php?symbol='; // Prefix for internal stock REST API
const UPDATE_INTERVAL = 2 * 60 * 1000; // 2 minutes in milliseconds
const CACHE_AGE_LIMIT = 1 * 60 * 1000; // minute in milliseconds

// Global variables
let stockUpdateTimer = null;
let stockDataCache = {}; // Cache object to store stock data by ticker
let showChange = true; // Flag to show change in stock price

// Import settings to check visibility setting
import { settings } from './settings.js';

// List of supported stock tickers
const STOCK_TICKERS = ['spy', 'dia', 'iwm', 'ief', 'btco', 'tsla'];

// Dynamically create stock indicator elements
function createStockIndicators() {
    const container = document.getElementById('stock-indicators');
    if (!container) return;

    STOCK_TICKERS.forEach(ticker => {
        const id = `stock-status-${ticker}`;
        if (!document.getElementById(id)) {
            const div = document.createElement('div');
            div.id = id;
            div.className = 'status-indicator stock-status neutral hidden';
            div.innerHTML = `${ticker.toUpperCase()}<span id="stock-arrow"></span><span id="stock-value">--</span>`;
            container.appendChild(div);
        }
    });
}

createStockIndicators();

// Function to start periodic updates
export function startStockUpdates() {
    updateStockIndicatorVisibility();

    const anyEnabled = STOCK_TICKERS.some(ticker =>
        settings[`show-stock-${ticker}`] !== false
    );

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
function fetchStockData() {
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
    // console.log(`US markets open: ${usMarketsOpen}`);
    
    // Find all stock indicators
    const stockElements = document.querySelectorAll('[id^="stock-status-"]');
    
    // Process each stock element independently using promises
    stockElements.forEach(element => {
        // Skip if the element is not visible
        if (element.style.display === 'none') {
            // console.log(`Skipping hidden element: ${element.id}`);
            return;
        }

        // Extract ticker from the element ID and capitalize it
        // Example: 'stock-status-aapl' -> 'AAPL'
        const ticker = element.id.replace('stock-status-', '').toUpperCase();
        
        // Check if we have valid cached data
        // console.log('Cache age: ', (currentTime - (stockDataCache[ticker] ? stockDataCache[ticker].timestamp : 0)) / 1000, 'seconds');
        if (stockDataCache[ticker] && 
            (((currentTime - stockDataCache[ticker].timestamp) < CACHE_AGE_LIMIT) ||
            !usMarketsOpen)) {
            // Use cached data
            // console.log(`Using cached data for ${ticker}`);
            updateStockDisplay(
                element.id,
                stockDataCache[ticker].percentChange,
                stockDataCache[ticker].price);
            return;
        }
        
        // Cache miss or expired, fetch fresh data
        console.log(`Fetching data for ${ticker}`);
        
        // Create and execute fetch promise without awaiting
        fetch(`${STOCK_API_ENDPOINT}${ticker}`)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Network response was not ok for ${ticker}`);
                }
                return response.json();
            })
            .then(data => {
                // Extract values from our simplified API response
                const percentChange = data.percentChange;
                const price = data.price;
                
                // Cache the data with current timestamp
                stockDataCache[ticker] = {
                    percentChange: percentChange,
                    price: price,
                    timestamp: Date.now()
                };
                
                // Update the stock status indicator
                updateStockDisplay(
                    element.id,
                    percentChange,
                    price);
            })
            .catch(error => {
                console.error(`Error fetching stock data for ${ticker}:`, error);
                // If there's an error, show dashes
                updateStockDisplay(element.id, null);
            });
    }); // for each ticker
    
    if (settings['show-price-alt']) {
        showChange = !showChange; // Toggle the display mode
    }
}

// Function to update the stock display with the percentage change
function updateStockDisplay(elementId, percentChange, price = null) {
    const stockStatus = document.getElementById(elementId);
    if (!stockStatus) {
        // throw an error if the element is not found
        console.error(`Element with ID ${elementId} not found.`);
        return;
    }

    // Find child elements
    const stockArrow = stockStatus.querySelector('span#stock-arrow');
    const stockValue = stockStatus.querySelector('span#stock-value');
    
    if (!stockArrow || !stockValue) return;
    
    if (percentChange === null) {
        // No data available
        stockStatus.className = 'status-indicator stock-status neutral';
        stockArrow.innerHTML = '--';
        stockValue.innerHTML = '--%';
        return;
    }
    
    // Format the percentage change with two decimal places
    const formattedChange = Math.abs(percentChange).toFixed(2);
    
    // Determine if the market is up, down, or unchanged
    if (percentChange > 0) {
        stockStatus.className = 'status-indicator stock-status up';
        stockArrow.innerHTML = '▲'; // Up arrow
    } else if (percentChange < 0) {
        stockStatus.className = 'status-indicator stock-status down';
        stockArrow.innerHTML = '▼'; // Down arrow
    } else {
        stockStatus.className = 'status-indicator stock-status neutral';
        stockArrow.innerHTML = '—'; // Horizontal line for unchanged
    }
    
    // Update the shown value
    if (settings['show-price-alt'] && !showChange) {
        stockValue.innerHTML = price ? `$${parseFloat(price).toFixed(2)}` : '--';
    } else {
        stockValue.innerHTML = formattedChange + '%';
    }
}

// Function to update stock indicator visibility based on settings
export function updateStockIndicatorVisibility() {
    const stockIndicators = document.querySelectorAll('[id^="stock-status-"]');
    stockIndicators.forEach(indicator => {
        if (indicator) {
            // Get the specific stock ticker from the ID
            const ticker = indicator.id.replace('stock-status-', '');
            const specificSetting = `show-stock-${ticker}`;
            
            // Primary check - individual setting
            // With backward compatibility via master switch
            const masterOk = settings["show-stock-indicator"] !== false; // For compatibility
            const specificOk = settings[specificSetting] !== false;
            
            // Only show if specifically enabled
            indicator.style.display = (masterOk && specificOk) ? '' : 'none';
        }
    });
}
