// clear-vendors.js
const { getAdminDb } = require('./config/firebase');
const logger = require('./utils/logger');

async function clearCollection(collectionName) {
  const db = getAdminDb();
  const batch = db.batch();
  const snapshot = await db.collection(collectionName).get();
  
  logger.info(`Found ${snapshot.size} documents in ${collectionName}`);
  
  snapshot.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });
  
  await batch.commit();
  logger.info(`Cleared ${snapshot.size} documents from ${collectionName}`);
}

async function clearAllVendors() {
  try {
    // Clear main vendors collection
    await clearCollection('vendors');
    
    // Clear priority vendors collection
    await clearCollection('priority_vendors');
    
    // Optionally clear other_vendors collection if you have one
    // await clearCollection('other_vendors');
    
    logger.info('Successfully cleared all vendor collections');
  } catch (error) {
    logger.error('Error clearing vendors:', error);
    process.exit(1);
  }
}

clearAllVendors();