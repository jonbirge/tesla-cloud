// Configuration
const STOCK_API_ENDPOINT = 'quote.php?symbol='; // Prefix for internal stock REST API
const UPDATE_INTERVAL = 5 * 60 * 1000; // 5 minutes in milliseconds
let stockUpdateTimer = null;

// Import settings to check visibility setting
import { settings } from './settings.js';

// Function to start periodic updates
export function startStockUpdates() {
    // Check if stock indicator should be visible
    updateStockIndicatorVisibility();
    
    // Fetch data immediately
    fetchStockData();
    
    // Set up periodic updates
    if (stockUpdateTimer) clearInterval(stockUpdateTimer);
    stockUpdateTimer = setInterval(fetchStockData, UPDATE_INTERVAL);
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
    
    // Find all stock indicators
    const stockElements = document.querySelectorAll('[id^="stock-status-"]');
    
    // Process each stock element independently using promises
    stockElements.forEach(element => {
        // Extract ticker from the element ID and capitalize it
        // Example: 'stock-status-aapl' -> 'AAPL'
        const ticker = element.id.replace('stock-status-', '').toUpperCase();
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
                
                // Update the stock status indicator
                updateStockDisplay(element.id, percentChange);
            })
            .catch(error => {
                console.error(`Error fetching stock data for ${ticker}:`, error);
                // If there's an error, show dashes
                updateStockDisplay(element.id, null);
            });
    });
}

// Function to update the stock display with the percentage change
function updateStockDisplay(elementId, percentChange) {
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
    
    // Update the percentage value
    stockValue.innerHTML = formattedChange + '%';
}

// Function to update stock indicator visibility based on settings
function updateStockIndicatorVisibility() {
    const stockIndicators = document.querySelectorAll('[id^="stock-status-"]');
    stockIndicators.forEach(indicator => {
        if (indicator) {
            indicator.style.display = (settings && settings["show-stock-indicator"] === false) ? 'none' : '';
        }
    });
}
