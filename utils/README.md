# Utilities

This directory contains shared utility functions and helper modules used across the application.

## Files
- `logger.js` - Centralized logging utility using Winston

## Features
### Logger
- Multiple log levels (error, warn, info, debug)
- File and console output
- Colorized console output
- JSON formatting for file logs
- Configurable log levels via environment variables

## Configuration
Set these environment variables in your `.env` file:
```
LOG_LEVEL=info  # error, warn, info, debug
```

## Usage Example
```javascript
const logger = require('./logger');

// Different log levels
logger.error('Something went wrong', { error: err });
logger.warn('Warning message');
logger.info('Processing complete', { stats });
logger.debug('Debug information');
``` 