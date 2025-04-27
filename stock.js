// Configuration
const STOCK_API_ENDPOINT = 'quote.php?symbol=SPY'; // Using our PHP proxy with SPY as S&P 500 proxy
const UPDATE_INTERVAL = 5 * 60 * 1000; // 5 minutes in milliseconds
let stockUpdateTimer = null;

// Import settings to check visibility setting
import { settings } from './settings.js';

// Function to fetch S&P 500 data
export async function fetchStockData() {
    try {
        const response = await fetch(STOCK_API_ENDPOINT);
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        const data = await response.json();
        
        // Extract values from our simplified API response
        const percentChange = data.percentChange;
        
        // Update the stock status indicator
        updateStockDisplay(percentChange);
        
        return percentChange;
    } catch (error) {
        console.error('Error fetching stock data:', error);
        // If there's an error, show dashes
        updateStockDisplay(null);
        return null;
    }
}

// Function to update the stock display with the percentage change
function updateStockDisplay(percentChange) {
    const stockStatus = document.getElementById('stock-status');
    const stockArrow = document.getElementById('stock-arrow');
    const stockValue = document.getElementById('stock-value');
    
    if (percentChange === null) {
        // No data available
        stockStatus.className = 'status-indicator stock-status neutral';
        stockArrow.innerHTML = '--';
        stockValue.innerHTML = '--%';
        return;
    }
    
    // Format the percentage change with one decimal place
    const formattedChange = Math.abs(percentChange).toFixed(1);
    
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
}

// Function to update stock indicator visibility based on settings
function updateStockIndicatorVisibility() {
    const stockIndicator = document.getElementById('stock-status');
    if (stockIndicator) {
        stockIndicator.style.display = (settings && settings["show-stock-indicator"] === false) ? 'none' : '';
    }
}
