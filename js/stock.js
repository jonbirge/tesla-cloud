// Configuration
const STOCK_API_ENDPOINT = 'php/quote.php?symbol='; // Prefix for internal stock REST API
const UPDATE_INTERVAL = 2 * 60 * 1000; // 2 minutes in milliseconds
const CACHE_AGE_LIMIT = 1 * 60 * 1000; // minute in milliseconds
const DISPLAY_ALTERNATE_INTERVAL = 5 * 1000; // 5 seconds in milliseconds
const MAX_VISIBLE_TICKERS = 3; // Only show three indicators at once in the UI
const TICKER_SCROLL_REPEAT = 2; // Duplicate the ticker list so the animation can loop
const TICKER_SCROLL_SECONDS_PER_SYMBOL = 3; // Seconds of scroll time per subscribed symbol
const MIN_TICKER_SCROLL_DURATION = 12; // Minimum duration so slow lists do not feel jittery

// Global variables
let stockUpdateTimer = null;
let displayAlternateTimer = null;
let stockDataCache = {}; // Cache object to store stock data by ticker
let showChange = true; // Flag to show change in stock price
let availableStocks = []; // List of available stocks from stocks.json
let availableIndexes = []; // List of available indexes from indexes.json
let isUpdating = false; // Flag to prevent duplicate update processes
let pendingTickerWidthFrame = null; // Used to throttle width calculations for the ticker window

// Import settings to check visibility setting
import { settings } from './settings.js';

// Load stock and index data
async function loadStockAndIndexData() {
    try {
        const [stocksResponse, indexesResponse] = await Promise.all([
            fetch('config/stocks.json'),
            fetch('config/indexes.json')
        ]);
        
        availableStocks = await stocksResponse.json();
        availableIndexes = await indexesResponse.json();
        
        console.log('Loaded stock and index data');
        updateStockIndicatorVisibility();
    } catch (error) {
        console.error('Error loading stock/index data:', error);
    }
}

// Get all subscribed tickers (stocks + indexes) in JSON order: indexes first, then stocks.
// Falls back to previous order if JSON not loaded yet.
function getSubscribedTickersOrdered() {
    const subscribedStocks = settings['subscribed-stocks'] || [];
    const subscribedIndexes = settings['subscribed-indexes'] || [];

    // If JSON data not loaded yet, preserve original behavior
    if (availableStocks.length === 0 && availableIndexes.length === 0) {
        return [...subscribedStocks, ...subscribedIndexes];
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

    // Append any subscribed symbols not present in the JSONs (preserve user setting order)
    const seen = new Set([...orderedIndexes.map(s => s.toUpperCase()), ...orderedStocks.map(s => s.toUpperCase())]);
    const extras = [];
    [...subscribedIndexes, ...subscribedStocks].forEach(sym => {
        if (!seen.has(sym.toUpperCase())) {
            extras.push(sym);
            seen.add(sym.toUpperCase());
        }
    });

    return [...orderedIndexes, ...orderedStocks, ...extras];
}

// Get all subscribed tickers (stocks + indexes)
function getSubscribedTickers() {
    const subscribedStocks = settings['subscribed-stocks'] || [];
    const subscribedIndexes = settings['subscribed-indexes'] || [];
    return [...subscribedStocks, ...subscribedIndexes];
}

// Helper to pull an index definition by its ETF ticker symbol
function getIndexEntry(ticker) {
    if (!ticker || availableIndexes.length === 0) {
        return null;
    }
    const upperTicker = ticker.toUpperCase();
    return availableIndexes.find(index => (index.TrackingETF || '').toUpperCase() === upperTicker) || null;
}

// Generate DOM elements for all stock indicators
function generateStockIndicatorElements(tickerList = null, repeatCount = 1) {
    const fragment = document.createDocumentFragment();
    const masterEnabled = settings["show-stock-indicator"] !== false;

    if (!masterEnabled) {
        return fragment;
    }

    const subscribedTickers = Array.isArray(tickerList) && tickerList.length > 0
        ? tickerList
        : getSubscribedTickersOrdered();

    if (subscribedTickers.length === 0) {
        return fragment;
    }

    for (let i = 0; i < repeatCount; i++) {
        subscribedTickers.forEach(ticker => {
            fragment.appendChild(createStockIndicatorElement(ticker));
        });
    }

    return fragment;
}

function createStockIndicatorElement(ticker) {
    const cached = stockDataCache[ticker.toUpperCase()];
    const displayData = getDisplayData(ticker, cached);

    let displayName = ticker.toUpperCase();
    const indexEntry = getIndexEntry(ticker);
    if (indexEntry && indexEntry.IndexName) {
        displayName = indexEntry.IndexName;
    }

    const div = document.createElement('div');
    div.id = `stock-status-${ticker.toLowerCase()}`;
    div.className = `status-indicator stock-status ${displayData.className}`;

    div.appendChild(document.createTextNode(displayName));

    const arrowSpan = document.createElement('span');
    arrowSpan.id = `stock-arrow-${ticker.toLowerCase()}`;
    arrowSpan.textContent = displayData.arrow;
    div.appendChild(arrowSpan);

    const valueSpan = document.createElement('span');
    valueSpan.id = `stock-value-${ticker.toLowerCase()}`;
    valueSpan.textContent = displayData.value;
    div.appendChild(valueSpan);

    return div;
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
    const indexData = getIndexEntry(ticker);
    const adjustedPercentChange = (() => {
        if (percentChange === null || percentChange === undefined) {
            return percentChange;
        }
        const units = (indexData && indexData.Units ? indexData.Units : '').toString().trim().toUpperCase();
        return units === 'YLD' ? -percentChange : percentChange;
    })();
    
    if (adjustedPercentChange === null || adjustedPercentChange === undefined) {
        return {
            className: 'neutral',
            arrow: '--',
            value: '--%'
        };
    }
    
    // Determine class and arrow based on percentage change
    let className, arrow;
    if (adjustedPercentChange > 0) {
        className = 'up';
        arrow = '▲';
    } else if (adjustedPercentChange < 0) {
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
        const isIndex = !!indexData;
        
        if (isIndex && price) {
            // Calculate index value: ETF price * coefficient
            if (indexData && indexData.Coefficient) {
                const indexValue = parseFloat(price) * parseFloat(indexData.Coefficient);
                const units = (indexData.Units || '').toString().trim();
                value = indexValue.toFixed(2) + units;
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
        value = Math.abs(adjustedPercentChange).toFixed(2) + '%';
    }
    
    return { className, arrow, value };
}

// Update the stock indicators container with new HTML
function updateStockIndicatorsContainer() {
    const container = document.getElementById('stock-indicators');
    if (!container) return;

    const masterEnabled = settings["show-stock-indicator"] !== false;
    const orderedTickers = getSubscribedTickersOrdered();
    const hasTickers = masterEnabled && orderedTickers.length > 0;

    if (!hasTickers) {
        container.classList.remove('ticker-mode');
        clearTickerWindowWidth(container);
        container.replaceChildren();
        return;
    }

    const needsTickerMode = orderedTickers.length > MAX_VISIBLE_TICKERS;
    const repeatCount = needsTickerMode ? TICKER_SCROLL_REPEAT : 1;
    const track = ensureTickerTrack(container);
    const elements = generateStockIndicatorElements(orderedTickers, repeatCount);

    container.classList.toggle('ticker-mode', needsTickerMode);
    track.replaceChildren(elements);

    if (needsTickerMode) {
        const tickerDurationSeconds = Math.max(
            orderedTickers.length * TICKER_SCROLL_SECONDS_PER_SYMBOL,
            MIN_TICKER_SCROLL_DURATION
        );
        track.style.setProperty('--ticker-animation-duration', `${tickerDurationSeconds}s`);
        updateTickerWindowWidth(container, track);
    } else {
        track.style.removeProperty('--ticker-animation-duration');
        clearTickerWindowWidth(container);
    }
}

function ensureTickerTrack(container) {
    let track = container.querySelector('.stock-ticker-track');
    if (!track) {
        track = document.createElement('div');
        track.className = 'stock-ticker-track';
        container.appendChild(track);
    }
    return track;
}

function updateTickerWindowWidth(container, track) {
    if (pendingTickerWidthFrame !== null) {
        cancelAnimationFrame(pendingTickerWidthFrame);
    }

    pendingTickerWidthFrame = requestAnimationFrame(() => {
        pendingTickerWidthFrame = null;
        const visibleChildren = Array.from(track.children).slice(0, MAX_VISIBLE_TICKERS);
        if (visibleChildren.length === 0) {
            container.style.removeProperty('--ticker-window-width');
            return;
        }

        let totalWidth = 0;
        visibleChildren.forEach(child => {
            const styles = window.getComputedStyle(child);
            const marginLeft = parseFloat(styles.marginLeft) || 0;
            const marginRight = parseFloat(styles.marginRight) || 0;
            totalWidth += child.offsetWidth + marginLeft + marginRight;
        });

        container.style.setProperty('--ticker-window-width', `${Math.ceil(totalWidth)}px`);
    });
}

function clearTickerWindowWidth(container) {
    if (pendingTickerWidthFrame !== null) {
        cancelAnimationFrame(pendingTickerWidthFrame);
        pendingTickerWidthFrame = null;
    }
    if (container) {
        container.style.removeProperty('--ticker-window-width');
    }
}

// Initialize on load
loadStockAndIndexData();

// Function to start periodic updates
export function startStockUpdates() {
    updateStockIndicatorVisibility();

    const subscribedTickers = getSubscribedTickers();
    const anyEnabled = subscribedTickers.length > 0 && settings["show-stock-indicator"] !== false;

    if (anyEnabled) {
        // Start data fetching timer only if not already running
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
    // Prevent concurrent fetch operations
    if (isUpdating) {
        console.log('Stock data fetch already in progress, skipping...');
        return;
    }
    
    console.log('Fetching financial data...');
    isUpdating = true;
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
        // console.log(`Fetching data for ${upperTicker}`);
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
                
                // Reset updating flag when all fetches are complete
                if (pendingFetches === 0) {
                    isUpdating = false;
                }
            });
    });
    
    // If no fetches were needed (all cached), still update display and reset flag
    if (pendingFetches === 0) {
        updateStockIndicatorsContainer();
        isUpdating = false;
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
