# Configuration Files

This directory contains JSON configuration files for various features of the application.

## Files

- `news.json` - News feed sources and categories
- `stocks.json` - Stock symbols to track
- `indexes.json` - Market indexes and their tracking ETFs

## news.json

Defines news feed sources organized by category.

### Structure

```json
{
  "sections": [...],
  "feeds": [...]
}
```

### Sections Array

Defines the category groupings for news feeds.

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier for the section |
| `title` | string | Display name for the section |
| `containerId` | string | HTML container ID for the section |
| `priority` | number | Display order (lower numbers first) |

### Feeds Array

Defines individual news feed sources.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique identifier for the feed |
| `name` | string | Yes | Display name for the feed |
| `url` | string | Yes | RSS/Atom feed URL |
| `refresh` | number | Yes | Refresh interval in minutes |
| `lifetime` | number | Yes | Article retention in days |
| `category` | string | Yes | Section ID this feed belongs to |
| `defaultEnabled` | boolean | Yes | Whether feed is enabled by default |
| `icon` | string | No | Domain or path for feed icon |

### Category Guidelines

- `general` - General news sources
- `business` - Business and financial news
- `technology` - Technology news (refresh: 720 min, lifetime: 1095 days)
- `defense` - Defense and aerospace news
- `tesla` - Automotive and Tesla news

### Example Feed Entry

```json
{
  "id": "techcrunch",
  "name": "TechCrunch",
  "url": "https://techcrunch.com/feed/",
  "refresh": 720,
  "lifetime": 1095,
  "category": "technology",
  "defaultEnabled": false,
  "icon": "https://techcrunch.com"
}
```

## stocks.json

Defines stock symbols to display and track.

### Structure

Array of stock objects.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `StockName` | string | Yes | Display name of the company |
| `Symbol` | string | Yes | Stock ticker symbol |
| `icon` | string | No | Domain or asset path for company icon |

### Example Entry

```json
{
  "StockName": "Tesla",
  "Symbol": "TSLA",
  "icon": "tesla.com"
}
```

## indexes.json

Defines market indexes tracked via ETFs with conversion coefficients.

### Structure

Array of index objects.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `IndexName` | string | Yes | Short identifier for the index |
| `Description` | string | Yes | Full name of the index |
| `TrackingETF` | string | Yes | ETF symbol used to track the index |
| `Coefficient` | number | Yes | Multiplier to convert ETF price to index value |
| `Units` | string | Yes | Unit type (empty for price, "YLD" for yield) |
| `DateValid` | string | Yes | Date when coefficient was calculated (YYYY-MM-DD) |
| `icon` | string | No | Domain for index provider icon |

### Example Entry

```json
{
  "IndexName": "S&P",
  "Description": "S&P 500",
  "TrackingETF": "SPY",
  "Coefficient": 10.0239338555,
  "Units": "",
  "DateValid": "2025-08-15",
  "icon": "standardandpoors.com"
}
```

### Notes on Coefficients

The `Coefficient` field is used to convert the ETF price to the actual index value:

```
Index Value = ETF Price × Coefficient
```

For example, if SPY is trading at $500 and the coefficient is 10.0239338555, the calculated S&P 500 value would be approximately 5,012.

Coefficients should be periodically updated as the relationship between ETF prices and index values changes over time. The `DateValid` field indicates when the coefficient was last calculated.

## Icon Fields

All configuration files support an optional `icon` field:

- Domain names (e.g., `"tesla.com"`) - Icon will be fetched from the domain
- Asset paths (e.g., `"assets/berkshire-globe.svg"`) - Icon loaded from local assets
- Full URLs (e.g., `"https://www.example.com"`) - Icon fetched from specific URL

## JSON Format Notes

- Standard JSON does not support comments
- All strings must use double quotes
- Trailing commas are not allowed
- Boolean values are lowercase (`true`, `false`)
- Numbers can be integers or decimals without quotes
