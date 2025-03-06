const { getAdminDb } = require('../../config/firebase');

/**
 * Syncs vendor data to Firestore
 * @param {Array} vendors - Array of vendor objects to sync
 * @param {Object} options - Sync options
 * @returns {Promise<Object>} - Results of the sync operation
 */
async function syncVendorsToFirestore(vendors, options = {}) {
  const {
    collection = 'vendors',
    batchSize = 500,
    merge = true
  } = options;
  
  try {
    const db = getAdminDb();
    const vendorsCollection = db.collection(collection);
    const results = { successful: [], failed: [] };
    
    // Process in batches to avoid Firestore limits
    for (let i = 0; i < vendors.length; i += batchSize) {
      const batch = db.batch();
      const currentBatch = vendors.slice(i, i + batchSize);
      
      currentBatch.forEach(vendor => {
        const docRef = vendorsCollection.doc(String(vendor.id));
        batch.set(docRef, {
          ...vendor,
          lastUpdated: new Date().toISOString()
        }, { merge });
      });
      
      await batch.commit();
      results.successful.push(...currentBatch.map(v => v.id));
    }
    
    return {
      success: true,
      stats: {
        total: vendors.length,
        successful: results.successful.length,
        failed: results.failed.length
      }
    };
  } catch (error) {
    console.error('Error syncing vendors to Firestore:', error);
    return {
      success: false,
      error: error.message,
      stats: {
        total: vendors.length,
        successful: 0,
        failed: vendors.length
      }
    };
  }
}

/**
 * Fetches vendors from Firestore
 * @param {Object} options - Query options
 * @returns {Promise<Array>} - Array of vendor objects
 */
async function fetchVendorsFromFirestore(options = {}) {
  const {
    collection = 'vendors',
    limit = 1000,
    where = []
  } = options;
  
  try {
    const db = getAdminDb();
    let query = db.collection(collection);
    
    // Apply where clauses if provided
    where.forEach(clause => {
      const [field, operator, value] = clause;
      query = query.where(field, operator, value);
    });
    
    // Apply limit
    if (limit) {
      query = query.limit(limit);
    }
    
    const snapshot = await query.get();
    const vendors = [];
    
    snapshot.forEach(doc => {
      vendors.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    return {
      success: true,
      vendors,
      count: vendors.length
    };
  } catch (error) {
    console.error('Error fetching vendors from Firestore:', error);
    return {
      success: false,
      error: error.message,
      vendors: []
    };
  }
}

module.exports = {
  syncVendorsToFirestore,
  fetchVendorsFromFirestore
}; 