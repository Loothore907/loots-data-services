# Firebase Service

This service manages all interactions with Firebase/Firestore database, handling vendor data synchronization and updates.

## Files
- `index.js` - Firebase service implementation with batch processing and error handling

## Features
- Firebase Admin SDK integration
- Batch processing for efficient database operations
- Support for different sync modes (overwrite, merge, update)
- Automatic retry on failures
- Validation before sync

## Configuration
Required environment variables in `.env`:
```
FIREBASE_API_KEY=your-api-key
FIREBASE_AUTH_DOMAIN=your-project-id.firebaseapp.com
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_STORAGE_BUCKET=your-project-id.appspot.com
FIREBASE_MESSAGING_SENDER_ID=your-sender-id
FIREBASE_APP_ID=your-app-id
FIREBASE_SERVICE_ACCOUNT_PATH=path/to/service-account.json
```

## Usage Example
```javascript
const { syncVendorsToFirestore } = require('./index');

const result = await syncVendorsToFirestore(vendors, {
  collection: 'vendors',
  batchSize: 500,
  merge: true
});
``` 