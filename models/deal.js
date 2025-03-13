// models/deal.js
const Joi = require('joi');
const { DealType, DayOfWeek, DAYS_OF_WEEK } = require('./Schema');


/**
 * Base deal validation schema
 */
const dealBaseSchema = Joi.object({
  id: Joi.alternatives().try(Joi.string(), Joi.number()),
  title: Joi.string().required(),
  description: Joi.string().required(),
  discount: Joi.string().required(),
  restrictions: Joi.array().items(Joi.string()).default([]),
  redemptionFrequency: Joi.string().valid(
    'once_per_day', 
    'once_per_visit', 
    'once', 
    'unlimited'
  ).default('once_per_visit'),
  isActive: Joi.boolean().default(true),
  createdAt: Joi.string().allow(null),
  updatedAt: Joi.string().allow(null),
  vendorId: Joi.string().required()
});

/**
 * Birthday deal schema
 */
const birthdayDealSchema = dealBaseSchema.keys({
  dealType: Joi.string().valid(DealType.BIRTHDAY).required()
});

/**
 * Daily deal schema
 */
const dailyDealSchema = dealBaseSchema.keys({
  dealType: Joi.string().valid(DealType.DAILY).required(),
  day: Joi.string().valid(...DAYS_OF_WEEK).required()
});

/**
 * Multi-Day deal schema
 */
const multiDayDealSchema = dealBaseSchema.keys({
  dealType: Joi.string().valid(DealType.MULTI_DAY).required(),
  days: Joi.array().items(Joi.string().valid(...DAYS_OF_WEEK)).min(1).required()
});

/**
 * Everyday deal schema
 */
const everydayDealSchema = dealBaseSchema.keys({
  dealType: Joi.string().valid(DealType.EVERYDAY).required()
});

/**
 * Special deal schema
 */
const specialDealSchema = dealBaseSchema.keys({
  dealType: Joi.string().valid(DealType.SPECIAL).required(),
  startDate: Joi.string().required(),
  endDate: Joi.string().required()
});

/**
 * Combined deal schema for validating all deal types
 */
const dealSchema = Joi.alternatives().try(
  birthdayDealSchema,
  dailyDealSchema,
  multiDayDealSchema,
  everydayDealSchema,
  specialDealSchema
);

/**
 * Validates deal object against appropriate schema
 * @param {Object} deal - Deal object to validate
 * @returns {Object} - Validation result
 */
function validateDeal(deal) {
  return dealSchema.validate(deal, { abortEarly: false });
}

/**
 * Normalizes a deal object to ensure proper structure
 * @param {Object} rawDeal - Raw deal data
 * @returns {Object} - Normalized deal object
 */
function normalizeDeal(rawDeal) {
  // Create a copy to avoid mutations
  const deal = { ...rawDeal };
  
  // Ensure arrays are properly initialized
  deal.restrictions = Array.isArray(deal.restrictions) ? deal.restrictions : [];
  
  // Convert empty strings to null for optional string fields
  Object.keys(deal).forEach(key => {
    if (typeof deal[key] === 'string' && deal[key].trim() === '') {
      deal[key] = null;
    }
  });
  
  // Ensure dates are in ISO format
  if (deal.dealType === DealType.SPECIAL) {
    if (deal.startDate) {
      try {
        deal.startDate = new Date(deal.startDate).toISOString();
      } catch (e) {
        // Keep as is if invalid
      }
    }
    
    if (deal.endDate) {
      try {
        deal.endDate = new Date(deal.endDate).toISOString();
      } catch (e) {
        // Keep as is if invalid
      }
    }
  }
  
  // Set timestamp fields if not present
  const now = new Date().toISOString();
  deal.createdAt = deal.createdAt || now;
  deal.updatedAt = now;
  
  if (deal.dealType === DealType.MULTI_DAY) {
    // Ensure days is always an array
    deal.days = Array.isArray(deal.days) ? deal.days : 
      (deal.days ? [deal.days] : []);
  }
  
  return deal;
}

/**
 * Fetches deals from Firestore
 * @param {Object} options - Query options
 * @returns {Promise<Object>} - Query results
 */
async function fetchDealsFromFirestore(options = {}) {
  const { getAdminDb } = require('../config/firebase');
  const {
    collection = 'deals',
    limit = 100,
    offset = 0,
    dealType,
    vendorId,
    day,
    activeOnly = true,
    orderBy = 'updatedAt',
    orderDir = 'desc',
    countOnly = false  // New param to support count-only queries
  } = options;
  
  try {
    const db = getAdminDb();
    let query = db.collection(collection);
    
    // Apply filters if provided
    if (dealType) {
      query = query.where('dealType', '==', dealType);
    }
    
    if (vendorId) {
      query = query.where('vendorId', '==', vendorId);
    }
    
    if (day) {
      query = query.where('day', '==', day);
    }
    
    if (activeOnly) {
      query = query.where('isActive', '==', true);
    }
    
    // For count-only queries, we don't need ordering or limit
    if (!countOnly) {
      // Apply ordering
      query = query.orderBy(orderBy, orderDir);
      
      // Apply limit and offset
      if (limit) {
        query = query.limit(limit);
      }
      
      if (offset > 0) {
        query = query.offset(offset);
      }
    }
    
    const snapshot = await query.get();
    const deals = [];
    
    // For count-only queries, we don't need to process the full documents
    if (countOnly) {
      return {
        success: true,
        count: snapshot.size,
        deals: []
      };
    }
    
    snapshot.forEach(doc => {
      deals.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    return {
      success: true,
      deals,
      count: deals.length
    };
  } catch (error) {
    console.error('Error fetching deals from Firestore:', error);
    return {
      success: false,
      error: error.message,
      deals: []
    };
  }
}

/**
 * Syncs deals to Firestore
 * @param {Array} deals - Array of deal objects
 * @param {Object} options - Sync options
 * @returns {Promise<Object>} - Results of sync operation
 */
async function syncDealsToFirestore(deals, options = {}) {
  const { getAdminDb } = require('../config/firebase');
  const {
    collection = 'deals',
    batchSize = 500,
    merge = true
  } = options;
  
  try {
    const db = getAdminDb();
    const dealsCollection = db.collection(collection);
    const results = { successful: [], failed: [] };
    
    // Process in batches to avoid Firestore limits
    for (let i = 0; i < deals.length; i += batchSize) {
      const batch = db.batch();
      const currentBatch = deals.slice(i, i + batchSize);
      
      currentBatch.forEach(deal => {
        const docRef = deal.id 
          ? dealsCollection.doc(String(deal.id))
          : dealsCollection.doc();
          
        // If new deal, assign the generated ID
        if (!deal.id) {
          deal.id = docRef.id;
        }
        
        // Update timestamp
        deal.updatedAt = new Date().toISOString();
        
        batch.set(docRef, deal, { merge });
      });
      
      await batch.commit();
      results.successful.push(...currentBatch.map(d => d.id));
    }
    
    return {
      success: true,
      stats: {
        total: deals.length,
        successful: results.successful.length,
        failed: results.failed.length
      }
    };
  } catch (error) {
    console.error('Error syncing deals to Firestore:', error);
    return {
      success: false,
      error: error.message,
      stats: {
        total: deals.length,
        successful: 0,
        failed: deals.length
      }
    };
  }
}

module.exports = {
  validateDeal,
  normalizeDeal,
  fetchDealsFromFirestore,
  syncDealsToFirestore,
  dealSchema,
  birthdayDealSchema,
  dailyDealSchema,
  everydayDealSchema,
  specialDealSchema,
  multiDayDealSchema
};