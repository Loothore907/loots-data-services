# Data Models

This directory contains data model definitions and validation schemas for the application.

## Files
- `vendor.js` - Vendor data model with Joi validation schema and normalization utilities

## Features
- Schema validation using Joi
- Data normalization functions
- Type checking and data cleaning
- Support for nested objects (location, contact, hours)

## Vendor Schema
The vendor model includes validation for:
- Basic information (id, name, license)
- Location data with coordinates
- Contact information
- Operating hours
- Special deals and partner status

## Usage Example
```javascript
const { validateVendor, normalizeVendor } = require('./vendor');

// Normalize raw vendor data
const normalized = normalizeVendor(rawVendor);

// Validate against schema
const { error, value } = validateVendor(normalized);
if (error) {
  console.error('Validation failed:', error.details);
} else {
  console.log('Valid vendor:', value);
}
``` 