// Stock Market Section Module
// Displays detailed stock and index information for user-selected securities

import { settings } from './settings.js';

// Utility to escape HTML special characters to prevent XSS
function escapeHTML(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
// Configuration
const STOCK_API_ENDPOINT = 'php/quote.php?symbol=';
const MARKET_UPDATE_INTERVAL = 60 * 1000; // 1 minute

// Module state
let marketUpdateTimer = null;
let availableStocks = [];
let availableIndexes = [];
let marketDataCache = {};

// Load stock and index configuration
async function loadMarketConfig() {
    try {
        const [stocksResponse, indexesResponse] = await Promise.all([
            fetch('config/stocks.json'),
            fetch('config/indexes.json')
        ]);
        
        availableStocks = await stocksResponse.json();
        availableIndexes = await indexesResponse.json();
    } catch (error) {
        console.error('Error loading market config:', error);
    }
}

// Initialize config on module load
loadMarketConfig();

// Get subscribed tickers ordered (indexes first, then stocks)
function getSubscribedTickersOrdered() {
    const subscribedStocks = settings['subscribed-stocks'] || [];
    const subscribedIndexes = settings['subscribed-indexes'] || [];

    if (availableStocks.length === 0 && availableIndexes.length === 0) {
        return { indexes: subscribedIndexes, stocks: subscribedStocks };
    }

    const stockSet = new Set(subscribedStocks.map(s => s.toUpperCase()));
    const indexSet = new Set(subscribedIndexes.map(s => s.toUpperCase()));

    const orderedIndexes = [];
    availableIndexes.forEach(idx => {
        if (indexSet.has((idx.TrackingETF || '').toUpperCase())) {
            orderedIndexes.push(idx.TrackingETF);
        }
    });

    const orderedStocks = [];
    availableStocks.forEach(st => {
        if (stockSet.has((st.Symbol || '').toUpperCase())) {
            orderedStocks.push(st.Symbol);
        }
    });

    return { indexes: orderedIndexes, stocks: orderedStocks };
}

// Get stock info from config
function getStockInfo(symbol) {
    const upperSymbol = symbol.toUpperCase();
    return availableStocks.find(s => s.Symbol.toUpperCase() === upperSymbol);
}

// Get index info from config
function getIndexInfo(symbol) {
    const upperSymbol = symbol.toUpperCase();
    return availableIndexes.find(i => (i.TrackingETF || '').toUpperCase() === upperSymbol);
}

// Resolve icon URL
function resolveIconUrl(iconUrl) {
    if (!iconUrl || typeof iconUrl !== 'string') {
        return 'assets/stock-default.svg';
    }

    const trimmed = iconUrl.trim();
    if (trimmed === '') {
        return 'assets/stock-default.svg';
    }

    if (trimmed.startsWith('assets/') || trimmed.startsWith('./assets/') || trimmed.startsWith('/assets/')) {
        return trimmed;
    }

    if (trimmed.toLowerCase().startsWith('http://') || trimmed.toLowerCase().startsWith('https://')) {
        return trimmed;
    }

    return `https://www.google.com/s2/favicons?domain=${trimmed}&sz=64`;
}

// Fetch detailed quote data for a symbol
async function fetchQuoteData(symbol) {
    try {
        const response = await fetch(`${STOCK_API_ENDPOINT}${symbol}`);
        if (!response.ok) {
            throw new Error(`Failed to fetch ${symbol}`);
        }
        const data = await response.json();
        marketDataCache[symbol.toUpperCase()] = {
            ...data,
            timestamp: Date.now()
        };
        return data;
    } catch (error) {
        console.error(`Error fetching quote for ${symbol}:`, error);
        return null;
    }
}

// Fetch all subscribed market data
async function fetchAllMarketData() {
    const { indexes, stocks } = getSubscribedTickersOrdered();
    const allSymbols = [...indexes, ...stocks];
    
    console.log('Fetching market data for:', allSymbols);
    
    const promises = allSymbols.map(symbol => fetchQuoteData(symbol));
    await Promise.all(promises);
    
    renderMarketSection();
}

// Format price with dollar sign
function formatPrice(price, isIndex = false, indexInfo = null) {
    if (price === null || price === undefined) {
        return '--';
    }
    
    if (isIndex && indexInfo && indexInfo.Coefficient) {
        const indexValue = parseFloat(price) * parseFloat(indexInfo.Coefficient);
        const units = (indexInfo.Units || '').toString().trim();
        return Math.round(indexValue).toString() + units;
    }
    
    return '$' + parseFloat(price).toFixed(2);
}

// Format percent change
function formatPercentChange(change, isYield = false) {
    if (change === null || change === undefined) {
        return { text: '--%', className: 'neutral', arrow: '--' };
    }
    
    const adjustedChange = isYield ? -change : change;
    const absChange = Math.abs(adjustedChange).toFixed(2);
    
    if (adjustedChange > 0) {
        return { text: `+${absChange}%`, className: 'up', arrow: '▲' };
    } else if (adjustedChange < 0) {
        return { text: `-${absChange}%`, className: 'down', arrow: '▼' };
    }
    return { text: `${absChange}%`, className: 'neutral', arrow: '—' };
}

// Format absolute change
function formatAbsoluteChange(change) {
    if (change === null || change === undefined) {
        return '--';
    }
    const value = parseFloat(change);
    const sign = value >= 0 ? '+' : '';
    return sign + value.toFixed(2);
}

// Calculate range position (0-100%)
function calculateRangePosition(current, low, high) {
    if (current === null || low === null || high === null) {
        return 50;
    }
    if (high === low) {
        return 50;
    }
    const position = ((current - low) / (high - low)) * 100;
    return Math.max(0, Math.min(100, position));
}

// Format timestamp
function formatQuoteTime(timestamp) {
    if (!timestamp) {
        return '';
    }
    const date = new Date(timestamp * 1000);
    const options = {
        hour: 'numeric',
        minute: '2-digit',
        hour12: !settings['24-hour-time']
    };
    return 'As of ' + date.toLocaleTimeString(undefined, options);
}

// Create market card element
function createMarketCard(symbol, data, isIndex = false) {
    const indexInfo = isIndex ? getIndexInfo(symbol) : null;
    const stockInfo = !isIndex ? getStockInfo(symbol) : null;
    const info = indexInfo || stockInfo;
    
    const card = document.createElement('div');
    card.className = 'market-card';
    card.dataset.symbol = symbol;
    
    // Determine display name
    let displayName = symbol;
    let displaySymbol = symbol;
    if (indexInfo) {
        displayName = indexInfo.Description || indexInfo.IndexName || symbol;
        displaySymbol = indexInfo.IndexName || symbol;
    } else if (stockInfo) {
        displayName = stockInfo.StockName || symbol;
        displaySymbol = stockInfo.Symbol || symbol;
    }
    
    // Get icon
    const iconUrl = resolveIconUrl(info?.icon);
    
    // Format values
    const isYield = indexInfo && (indexInfo.Units || '').toString().trim().toUpperCase() === 'YLD';
    const priceDisplay = formatPrice(data?.price, isIndex, indexInfo);
    const changeInfo = formatPercentChange(data?.percentChange, isYield);
    const absChange = formatAbsoluteChange(data?.change);
    const openPrice = data && data.open != null ? '$' + parseFloat(data.open).toFixed(2) : '--';
    const highPrice = data && data.high != null ? '$' + parseFloat(data.high).toFixed(2) : '--';
    const lowPrice = data && data.low != null ? '$' + parseFloat(data.low).toFixed(2) : '--';
    const prevClose = data && data.previousClose != null ? '$' + parseFloat(data.previousClose).toFixed(2) : '--';
    
    // Calculate range position
    const rangePosition = calculateRangePosition(data?.price, data?.low, data?.high);
    
    // Build card HTML
    card.innerHTML = `
        <div class="market-card-header">
            <img class="market-card-icon" src="${escapeHTML(iconUrl)}" alt="${escapeHTML(displaySymbol)}" onerror="this.src='assets/stock-default.svg'">
            <div class="market-card-title">
                <span class="market-card-name">${escapeHTML(displayName)}</span>
                <span class="market-card-symbol">${escapeHTML(displaySymbol)}</span>
            </div>
        </div>
        <div class="market-card-price">
            <span class="market-price-value">${priceDisplay}</span>
            <div class="market-price-change ${changeInfo.className}">
                <span class="market-change-arrow">${changeInfo.arrow}</span>
                <span>${absChange}</span>
                <span class="market-change-percent">(${changeInfo.text})</span>
            </div>
        </div>
        <div class="market-card-stats">
            <div class="market-stat">
                <span class="market-stat-label">Open</span>
                <span class="market-stat-value">${openPrice}</span>
            </div>
            <div class="market-stat">
                <span class="market-stat-label">Prev Close</span>
                <span class="market-stat-value">${prevClose}</span>
            </div>
            <div class="market-stat">
                <span class="market-stat-label">Day High</span>
                <span class="market-stat-value">${highPrice}</span>
            </div>
            <div class="market-stat">
                <span class="market-stat-label">Day Low</span>
                <span class="market-stat-value">${lowPrice}</span>
            </div>
        </div>
        <div class="market-range-container">
            <div class="market-range-labels">
                <span>Day Low</span>
                <span>Day High</span>
            </div>
            <div class="market-range-bar">
                <div class="market-range-marker" style="left: ${rangePosition}%;"></div>
            </div>
            <div class="market-range-values">
                <span>${lowPrice}</span>
                <span>${highPrice}</span>
            </div>
        </div>
        <div class="market-quote-time">${formatQuoteTime(data?.quoteTime)}</div>
    `;
    
    return card;
}

// Render the market section
function renderMarketSection() {
    const indexesGrid = document.getElementById('market-indexes-grid');
    const stocksGrid = document.getElementById('market-stocks-grid');
    const loadingIndicator = document.getElementById('market-loading');
    const emptyState = document.getElementById('market-empty');
    
    if (!indexesGrid || !stocksGrid) {
        return;
    }
    
    // Hide loading
    if (loadingIndicator) {
        loadingIndicator.style.display = 'none';
    }
    
    const { indexes, stocks } = getSubscribedTickersOrdered();
    
    // Check if there's anything to display
    if (indexes.length === 0 && stocks.length === 0) {
        if (emptyState) {
            emptyState.style.display = 'block';
        }
        indexesGrid.innerHTML = '';
        stocksGrid.innerHTML = '';
        return;
    }
    
    if (emptyState) {
        emptyState.style.display = 'none';
    }
    
    // Render indexes
    indexesGrid.innerHTML = '';
    if (indexes.length > 0) {
        indexes.forEach(symbol => {
            const data = marketDataCache[symbol.toUpperCase()];
            const card = createMarketCard(symbol, data, true);
            indexesGrid.appendChild(card);
        });
        document.getElementById('market-indexes-section').style.display = 'block';
    } else {
        document.getElementById('market-indexes-section').style.display = 'none';
    }
    
    // Render stocks
    stocksGrid.innerHTML = '';
    if (stocks.length > 0) {
        stocks.forEach(symbol => {
            const data = marketDataCache[symbol.toUpperCase()];
            const card = createMarketCard(symbol, data, false);
            stocksGrid.appendChild(card);
        });
        document.getElementById('market-stocks-section').style.display = 'block';
    } else {
        document.getElementById('market-stocks-section').style.display = 'none';
    }
}

// Start market updates
export function startMarketUpdates() {
    console.log('Starting market section updates');
    fetchAllMarketData();
    
    if (!marketUpdateTimer) {
        marketUpdateTimer = setInterval(fetchAllMarketData, MARKET_UPDATE_INTERVAL);
    }
}

// Stop market updates
export function stopMarketUpdates() {
    console.log('Stopping market section updates');
    if (marketUpdateTimer) {
        clearInterval(marketUpdateTimer);
        marketUpdateTimer = null;
    }
}

// Initialize market section when visible
export function initMarketSection() {
    console.log('Initializing market section');
    startMarketUpdates();
}

// Refresh market data (can be called externally)
export function refreshMarketData() {
    fetchAllMarketData();
}
