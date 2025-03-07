// clear-vendors.js
const { getAdminDb } = require('./config/firebase');

async function clearVendorsCollection() {
  try {
    const db = getAdminDb();
    const vendorsRef = db.collection('vendors');
    
    // Get all documents in the collection
    const snapshot = await vendorsRef.get();
    
    // Delete in batches (Firestore has limits on batch operations)
    const batchSize = 500;
    let batch = db.batch();
    let count = 0;
    
    snapshot.forEach(doc => {
      batch.delete(doc.ref);
      count++;
      
      // Commit when batch size is reached
      if (count >= batchSize) {
        batch.commit();
        batch = db.batch();
        count = 0;
      }
    });
    
    // Commit any remaining deletes
    if (count > 0) {
      await batch.commit();
    }
    
    console.log(`Deleted ${snapshot.size} vendors from collection`);
  } catch (error) {
    console.error('Error clearing vendors collection:', error);
  }
}

clearVendorsCollection();