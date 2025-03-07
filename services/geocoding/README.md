# Geocoding Service

This service handles the conversion of addresses to geographic coordinates (latitude/longitude) using various geocoding providers.

## Files
- `index.js` - Main geocoding service implementation with address validation and batch processing

## Features
- Configurable geocoding provider (default: OpenStreetMap)
- Rate limiting and concurrent request handling
- Batch processing with error handling
- Support for skipping already geocoded addresses

## Configuration
Set these environment variables in your `.env` file:
```
GEOCODER_PROVIDER=openstreetmap
GEOCODER_API_KEY=your-api-key  # Required for some providers like Google Maps
```

## Usage Example
```javascript
const { geocodeAddress, batchGeocodeVendors } = require('./index');

// Single address geocoding
const result = await geocodeAddress('123 Main St, City, State');

// Batch geocoding
const results = await batchGeocodeVendors(vendors, {
  concurrency: 2,
  delayMs: 200
});
``` 