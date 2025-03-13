// routes/deals.js
const express = require('express');
const router = express.Router();
const { getAdminDb } = require('../config/firebase');
const { 
  validateDeal, 
  normalizeDeal, 
  fetchDealsFromFirestore
} = require('../models/deal');
const { DealType, DayOfWeek, DAYS_OF_WEEK } = require('../models/Schema');
const logger = require('../utils/logger');

// Dashboard/listing view for deals
router.get('/', async (req, res) => {
  try {
    // Get query parameters for filtering
    const dealType = req.query.dealType;
    const vendorId = req.query.vendorId;
    const day = req.query.day;
    const activeOnly = req.query.activeOnly !== 'false'; // Default to true
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    
    // First get total count of all deals without any filtering
    const totalCountResult = await fetchDealsFromFirestore({
      activeOnly: false, // Count all deals for accurate total
      limit: 1000,       // Set high limit to get all deals
      countOnly: true    // Only get count, not full data
    });
    
    // Now fetch deals based on filters for display
    const result = await fetchDealsFromFirestore({
      dealType,
      vendorId,
      day,
      activeOnly,
      limit: limit,
      offset: (page - 1) * limit
    });
    
    if (!result.success) {
      logger.error('Error fetching deals:', result.error);
      return res.status(500).render('error', { error: 'Failed to fetch deals' });
    }
    
    // Get vendors to display names
    const dbInstance = getAdminDb();
    const vendorIds = [...new Set(result.deals.map(deal => deal.vendorId))];
    const vendorData = {};
    
    if (vendorIds.length > 0) {
      const vendorSnapshots = await Promise.all(
        vendorIds.map(id => dbInstance.collection('vendors').doc(id).get())
      );
      
      vendorSnapshots.forEach(doc => {
        if (doc.exists) {
          const data = doc.data();
          vendorData[doc.id] = {
            name: data.name,
            isActive: data.status && ['Active-Operating', 'Active', 'Operating'].includes(data.status),
            status: data.status || 'Unknown',
            hasDealWarning: data.status && !['Active-Operating', 'Active', 'Operating'].includes(data.status)
          };
        }
      });
    }
    
    // Calculate statistics for dashboard
    const allDeals = result.deals;
    
    const stats = {
      total: totalCountResult.success ? totalCountResult.count : allDeals.length,
      byType: {
        [DealType.BIRTHDAY]: allDeals.filter(d => d.dealType === DealType.BIRTHDAY).length,
        [DealType.DAILY]: allDeals.filter(d => d.dealType === DealType.DAILY).length,
        [DealType.MULTI_DAY]: allDeals.filter(d => d.dealType === DealType.MULTI_DAY).length,
        [DealType.EVERYDAY]: allDeals.filter(d => d.dealType === DealType.EVERYDAY).length,
        [DealType.SPECIAL]: allDeals.filter(d => d.dealType === DealType.SPECIAL).length
      },
      activeVendors: Object.values(vendorData).filter(v => v.isActive).length,
      totalVendors: Object.keys(vendorData).length
    };
    
    // Deals by day of week (for daily deals)
    const dealsByDay = {};
    DAYS_OF_WEEK.forEach(day => {
      // Count single-day deals for this day
      const dailyDealsCount = allDeals.filter(d => 
        d.dealType === DealType.DAILY && d.day === day
      ).length;
      
      // Count multi-day deals that include this day
      const multiDayDealsCount = allDeals.filter(d => 
        d.dealType === DealType.MULTI_DAY && 
        Array.isArray(d.days) && 
        d.days.includes(day)
      ).length;
      
      dealsByDay[day] = dailyDealsCount + multiDayDealsCount;
    });
    stats.byDay = dealsByDay;
    
    // Check for special deals expiring soon (next 7 days)
    const now = new Date();
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(now.getDate() + 7);
    
    stats.expiringSoon = allDeals.filter(deal => {
      if (deal.dealType !== DealType.SPECIAL) return false;
      
      try {
        const endDate = new Date(deal.endDate);
        return endDate > now && endDate <= sevenDaysFromNow;
      } catch {
        return false;
      }
    }).length;
    
    // Render the deals dashboard view
    res.render('deals/index', { 
      deals: result.deals, 
      vendorData,
      stats,
      filters: {
        dealType,
        vendorId,
        day,
        activeOnly
      },
      pagination: {
        current: page,
        limit,
        total: Math.ceil(result.count / limit),
        totalItems: result.count
      },
      dealTypes: Object.values(DealType),
      daysOfWeek: DAYS_OF_WEEK,
      currentUrl: req.originalUrl
    });
  } catch (error) {
    logger.error('Error loading deals page:', error);
    res.status(500).render('error', { error: 'Failed to load deals page' });
  }
});

// Form for creating a new deal
router.get('/new', async (req, res) => {
  try {
    // Set vendor ID if passed as query parameter
    const vendorId = req.query.vendorId || '';
    
    // Fetch all vendors for dropdown
    const dbInstance = getAdminDb();
    const vendorsSnapshot = await dbInstance.collection('vendors')
      .where('status', 'in', ['Active-Operating', 'Active', 'Operating'])
      .orderBy('name')
      .get();
    
    const vendors = [];
    vendorsSnapshot.forEach(doc => {
      vendors.push({
        id: doc.id,
        name: doc.data().name
      });
    });
    
    // Initialize a completely blank deal with just the vendorId preserved
    // This ensures the form is truly fresh when using "Save & Add Another"
    res.render('deals/form', {
      deal: { 
        vendorId, 
        isActive: true, 
        dealType: '', 
        redemptionFrequency: 'once_per_visit',
        title: '',
        description: '',
        discount: '',
        restrictions: []
      },
      vendors,
      dealTypes: Object.values(DealType),
      daysOfWeek: DAYS_OF_WEEK,
      isNew: true,
      errors: {}
    });
  } catch (error) {
    logger.error('Error loading deal creation form:', error);
    res.status(500).render('error', { error: 'Failed to load deal creation form' });
  }
});

// Create a new deal
router.post('/', async (req, res) => {
  try {
    // Prepare the deal data
    const dealData = {
      title: req.body.title,
      description: req.body.description,
      discount: req.body.discount,
      dealType: req.body.dealType,
      vendorId: req.body.vendorId,
      redemptionFrequency: req.body.redemptionFrequency,
      isActive: req.body.isActive === 'on'
    };
    
    // Check vendor status first before proceeding
    const dbInstance = getAdminDb();
    const vendorDoc = await dbInstance.collection('vendors').doc(dealData.vendorId).get();
    
    if (!vendorDoc.exists) {
      const vendors = await fetchActiveVendors();
      return res.render('deals/form', {
        deal: dealData,
        vendors,
        dealTypes: Object.values(DealType),
        daysOfWeek: DAYS_OF_WEEK,
        isNew: true,
        errors: { vendorId: 'Selected vendor does not exist' }
      });
    }
    
    const vendorData = vendorDoc.data();
    const vendorStatus = vendorData.status || '';
    const isVendorActive = ['Active-Operating', 'Active', 'Operating'].includes(vendorStatus);
    
    if (!isVendorActive && dealData.isActive) {
      // Don't allow active deals for inactive vendors
      const vendors = await fetchActiveVendors();
      return res.render('deals/form', {
        deal: dealData,
        vendors,
        dealTypes: Object.values(DealType),
        daysOfWeek: DAYS_OF_WEEK,
        isNew: true,
        errors: { 
          vendorId: `Cannot create active deals for vendors with '${vendorStatus}' status. Please set the deal to inactive or select an active vendor.` 
        }
      });
    }
    
    // Handle restrictions (convert from form to array)
    if (req.body.restrictions) {
      dealData.restrictions = req.body.restrictions
        .split('\n')
        .map(r => r.trim())
        .filter(r => r);
    }
    
    // Add deal type specific fields
    switch (dealData.dealType) {
      case DealType.DAILY:
        dealData.day = req.body.day;
        break;
      case DealType.MULTI_DAY:
        // Handle days array from form submission
        if (req.body.days) {
          // If it's a single value, wrap it in an array
          dealData.days = Array.isArray(req.body.days) ? req.body.days : [req.body.days];
        } else {
          dealData.days = [];
        }
        break;
      case DealType.SPECIAL:
        dealData.startDate = req.body.startDate;
        dealData.endDate = req.body.endDate;
        break;
    }
    
    // Normalize and validate
    const normalized = normalizeDeal(dealData);
    const { error } = validateDeal(normalized);
    
    if (error) {
      // Fetch vendors for the form
      const db = getAdminDb();
      const vendorsSnapshot = await db.collection('vendors')
        .where('status', 'in', ['Active-Operating', 'Active', 'Operating'])
        .orderBy('name')
        .get();
      
      const vendors = [];
      vendorsSnapshot.forEach(doc => {
        vendors.push({
          id: doc.id,
          name: doc.data().name
        });
      });
      
      // Format restrictions for textarea display
      if (Array.isArray(dealData.restrictions)) {
        dealData.restrictionsText = dealData.restrictions.join('\n');
      }
      
      return res.render('deals/form', {
        deal: dealData,
        vendors,
        dealTypes: Object.values(DealType),
        daysOfWeek: DAYS_OF_WEEK,
        isNew: false,
        errors: error.details.reduce((acc, curr) => {
          acc[curr.path[0]] = curr.message;
          return acc;
        }, {})
      });
    }
    
    // Save to Firestore
    const db = getAdminDb();
    const dealRef = await db.collection('deals').add(normalized);
    
    logger.info(`Created new deal: ${dealRef.id} (${normalized.title}) for ${vendorData[normalized.vendorId]?.name || normalized.vendorId}`);
    
    // Check if the form was submitted with "Save and Add Another" button
    if (req.body.saveAndAddAnother) {
      return res.redirect('/deals/new?vendorId=' + normalized.vendorId);
    }
    
    res.redirect('/deals');
  } catch (error) {
    logger.error('Error creating deal:', error);
    res.status(500).render('error', { error: 'Failed to create deal' });
  }
});

// Show deal edit form
router.get('/:id/edit', async (req, res) => {
  try {
    const dbInstance = getAdminDb();
    const dealDoc = await dbInstance.collection('deals').doc(req.params.id).get();
    
    if (!dealDoc.exists) {
      return res.status(404).render('error', { error: 'Deal not found' });
    }
    
    const deal = {
      id: dealDoc.id,
      ...dealDoc.data()
    };
    
    // Format restrictions for textarea display
    if (Array.isArray(deal.restrictions)) {
      deal.restrictionsText = deal.restrictions.join('\n');
    }
    
    // Fetch all vendors for dropdown
    const vendorsSnapshot = await dbInstance.collection('vendors')
      .where('status', 'in', ['Active-Operating', 'Active', 'Operating'])
      .orderBy('name')
      .get();
    
    const vendors = [];
    vendorsSnapshot.forEach(doc => {
      vendors.push({
        id: doc.id,
        name: doc.data().name
      });
    });
    
    res.render('deals/form', {
      deal,
      vendors,
      dealTypes: Object.values(DealType),
      daysOfWeek: DAYS_OF_WEEK,
      isNew: false,
      errors: {}
    });
  } catch (error) {
    logger.error('Error loading deal for editing:', error);
    res.status(500).render('error', { error: 'Failed to load deal for editing' });
  }
});

// Update deal
router.post('/:id', async (req, res) => {
  try {
    // Prepare the deal data
    const dealData = {
      id: req.params.id,
      title: req.body.title,
      description: req.body.description,
      discount: req.body.discount,
      dealType: req.body.dealType,
      vendorId: req.body.vendorId,
      redemptionFrequency: req.body.redemptionFrequency,
      isActive: req.body.isActive === 'on'
    };
    
    // Check vendor status first before proceeding
    const dbInstance = getAdminDb();
    const vendorDoc = await dbInstance.collection('vendors').doc(dealData.vendorId).get();
    
    if (!vendorDoc.exists) {
      // Get vendors for dropdown in form
      const vendors = await fetchActiveVendors();
      
      // Format restrictions for textarea display
      if (Array.isArray(dealData.restrictions)) {
        dealData.restrictionsText = dealData.restrictions.join('\n');
      }
      
      return res.render('deals/form', {
        deal: dealData,
        vendors,
        dealTypes: Object.values(DealType),
        daysOfWeek: DAYS_OF_WEEK,
        isNew: false,
        errors: { vendorId: 'Selected vendor does not exist' }
      });
    }
    
    const vendorData = vendorDoc.data();
    const vendorStatus = vendorData.status || '';
    const isVendorActive = ['Active-Operating', 'Active', 'Operating'].includes(vendorStatus);
    
    if (!isVendorActive && dealData.isActive) {
      // Don't allow active deals for inactive vendors
      const vendors = await fetchActiveVendors();
      
      // Format restrictions for textarea display
      if (Array.isArray(dealData.restrictions)) {
        dealData.restrictionsText = dealData.restrictions.join('\n');
      }
      
      return res.render('deals/form', {
        deal: dealData,
        vendors,
        dealTypes: Object.values(DealType),
        daysOfWeek: DAYS_OF_WEEK,
        isNew: false,
        errors: { 
          vendorId: `Cannot set deal to active for vendors with '${vendorStatus}' status. Please set the deal to inactive or select an active vendor.` 
        }
      });
    }
    
    // Handle restrictions (convert from form to array)
    if (req.body.restrictions) {
      dealData.restrictions = req.body.restrictions
        .split('\n')
        .map(r => r.trim())
        .filter(r => r);
    }
    
    // Add deal type specific fields
    switch (dealData.dealType) {
      case DealType.DAILY:
        dealData.day = req.body.day;
        break;
      case DealType.MULTI_DAY:
        // Handle days array from form submission
        if (req.body.days) {
          // If it's a single value, wrap it in an array
          dealData.days = Array.isArray(req.body.days) ? req.body.days : [req.body.days];
        } else {
          dealData.days = [];
        }
        break;
      case DealType.SPECIAL:
        dealData.startDate = req.body.startDate;
        dealData.endDate = req.body.endDate;
        break;
    }
    
    // Normalize and validate
    const normalized = normalizeDeal(dealData);
    const { error } = validateDeal(normalized);
    
    if (error) {
      // Fetch vendors for the form
      const db = getAdminDb();
      const vendorsSnapshot = await db.collection('vendors')
        .where('status', 'in', ['Active-Operating', 'Active', 'Operating'])
        .orderBy('name')
        .get();
      
      const vendors = [];
      vendorsSnapshot.forEach(doc => {
        vendors.push({
          id: doc.id,
          name: doc.data().name
        });
      });
      
      // Format restrictions for textarea display
      if (Array.isArray(dealData.restrictions)) {
        dealData.restrictionsText = dealData.restrictions.join('\n');
      }
      
      return res.render('deals/form', {
        deal: dealData,
        vendors,
        dealTypes: Object.values(DealType),
        daysOfWeek: DAYS_OF_WEEK,
        isNew: false,
        errors: error.details.reduce((acc, curr) => {
          acc[curr.path[0]] = curr.message;
          return acc;
        }, {})
      });
    }
    
    // Save to Firestore
    const db = getAdminDb();
    await db.collection('deals').doc(req.params.id).update(normalized);
    
    logger.info(`Updated deal: ${req.params.id} (${normalized.title})`);
    res.redirect('/deals');
  } catch (error) {
    logger.error('Error updating deal:', error);
    res.status(500).render('error', { error: 'Failed to update deal' });
  }
});

// Delete deal
router.post('/:id/delete', async (req, res) => {
  try {
    const db = getAdminDb();
    await db.collection('deals').doc(req.params.id).delete();
    
    logger.info(`Deleted deal: ${req.params.id}`);
    res.redirect('/deals');
  } catch (error) {
    logger.error('Error deleting deal:', error);
    res.status(500).render('error', { error: 'Failed to delete deal' });
  }
});

// Duplicate deal
router.post('/:id/duplicate', async (req, res) => {
  try {
    const db = getAdminDb();
    const dealDoc = await db.collection('deals').doc(req.params.id).get();
    
    if (!dealDoc.exists) {
      return res.status(404).render('error', { error: 'Deal not found' });
    }
    
    // Get the original deal data and remove/reset fields for duplication
    const originalDeal = dealDoc.data();
    delete originalDeal.id;
    originalDeal.title = `Copy of ${originalDeal.title}`;
    originalDeal.createdAt = new Date().toISOString();
    originalDeal.updatedAt = new Date().toISOString();
    
    // Save the duplicated deal
    const newDealRef = await db.collection('deals').add(originalDeal);
    
    logger.info(`Duplicated deal ${req.params.id} to new deal ${newDealRef.id}`);
    res.redirect(`/deals/${newDealRef.id}/edit`);
  } catch (error) {
    logger.error('Error duplicating deal:', error);
    res.status(500).render('error', { error: 'Failed to duplicate deal' });
  }
});

// Toggle deal active status
router.post('/:id/toggle-status', async (req, res) => {
  try {
    const isActive = req.body.isActive === 'true';
    const dbInstance = getAdminDb();
    
    // If trying to activate a deal, we need to check vendor status
    if (isActive) {
      // First get the deal to find the vendor
      const dealDoc = await dbInstance.collection('deals').doc(req.params.id).get();
      
      if (!dealDoc.exists) {
        return res.status(404).render('error', { error: 'Deal not found' });
      }
      
      const dealData = dealDoc.data();
      
      // Now check the vendor status
      const vendorDoc = await dbInstance.collection('vendors').doc(dealData.vendorId).get();
      
      if (vendorDoc.exists) {
        const vendorData = vendorDoc.data();
        const vendorStatus = vendorData.status || '';
        const isVendorActive = ['Active-Operating', 'Active', 'Operating'].includes(vendorStatus);
        
        if (!isVendorActive) {
          // Redirect back with error message
          const redirectUrl = req.body.returnUrl || '/deals';
          return res.redirect(`${redirectUrl}?error=Cannot activate deal for vendor with '${vendorStatus}' status.`);
        }
      }
    }
    
    // If we get here, we can update the deal status
    await dbInstance.collection('deals').doc(req.params.id).update({
      isActive: isActive,
      updatedAt: new Date().toISOString()
    });
    
    logger.info(`Toggled deal ${req.params.id} active status to: ${isActive}`);
    
    // Redirect back to referrer or deals list
    const redirectUrl = req.body.returnUrl || '/deals';
    res.redirect(redirectUrl);
  } catch (error) {
    logger.error('Error toggling deal status:', error);
    res.status(500).render('error', { error: 'Failed to toggle deal status' });
  }
});

// Helper function to fetch active vendors
async function fetchActiveVendors() {
  const dbInstance = getAdminDb();
  const vendorsSnapshot = await dbInstance.collection('vendors')
    .where('status', 'in', ['Active-Operating', 'Active', 'Operating'])
    .orderBy('name')
    .get();
  
  const vendors = [];
  vendorsSnapshot.forEach(doc => {
    vendors.push({
      id: doc.id,
      name: doc.data().name
    });
  });
  
  return vendors;
}

module.exports = router;