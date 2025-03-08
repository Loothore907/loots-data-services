// routes/vendors.js
const express = require('express');
const router = express.Router();
const { getAdminDb } = require('../config/firebase');
const { normalizeVendor, validateVendor } = require('../models/vendor');
const logger = require('../utils/logger');

// List vendors with pagination and filtering
router.get('/', async (req, res) => {
  try {
    const db = getAdminDb();
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const searchTerm = req.query.search || '';
    const status = req.query.status || '';
    const region = req.query.region || '';
    
    // Build query
    let query = db.collection('vendors');
    
    // Add filters if provided
    if (status) {
      query = query.where('status', '==', status);
    }
    
    // Get total count for pagination
    const countSnapshot = await query.count().get();
    const totalVendors = countSnapshot.data().count;
    
    // Apply pagination
    query = query.orderBy('name')
                .limit(limit)
                .offset((page - 1) * limit);
    
    // Execute query
    const snapshot = await query.get();
    const vendors = [];
    
    snapshot.forEach(doc => {
      const vendor = {
        id: doc.id,
        ...doc.data()
      };
      
      // Apply search filter client-side if needed
      if (searchTerm && !vendor.name.toLowerCase().includes(searchTerm.toLowerCase())) {
        return;
      }
      
      // Apply region filter client-side
      if (region && (!vendor.location || !vendor.location.address || !vendor.location.address.includes(region))) {
        return;
      }
      
      vendors.push(vendor);
    });
    
    // Render the vendor list page
    res.render('vendors/index', {
      vendors,
      pagination: {
        current: page,
        limit,
        total: Math.ceil(totalVendors / limit),
        totalItems: totalVendors
      },
      filters: {
        search: searchTerm,
        status,
        region
      }
    });
  } catch (error) {
    logger.error('Error fetching vendors:', error);
    res.status(500).render('error', { error: 'Failed to fetch vendors' });
  }
});

// Show vendor creation form
router.get('/new', (req, res) => {
  res.render('vendors/new', { vendor: {}, errors: {} });
});

// Show single vendor
router.get('/:id', async (req, res) => {
  try {
    const db = getAdminDb();
    const vendorDoc = await db.collection('vendors').doc(req.params.id).get();
    
    if (!vendorDoc.exists) {
      return res.status(404).render('error', { error: 'Vendor not found' });
    }
    
    const vendor = {
      id: vendorDoc.id,
      ...vendorDoc.data()
    };
    
    res.render('vendors/show', { vendor });
  } catch (error) {
    logger.error('Error fetching vendor:', error);
    res.status(500).render('error', { error: 'Failed to fetch vendor details' });
  }
});

// Show vendor edit form
router.get('/:id/edit', async (req, res) => {
  try {
    const db = getAdminDb();
    const vendorDoc = await db.collection('vendors').doc(req.params.id).get();
    
    if (!vendorDoc.exists) {
      return res.status(404).render('error', { error: 'Vendor not found' });
    }
    
    const vendor = {
      id: vendorDoc.id,
      ...vendorDoc.data()
    };
    
    res.render('vendors/edit', { vendor, errors: {} });
  } catch (error) {
    logger.error('Error fetching vendor for editing:', error);
    res.status(500).render('error', { error: 'Failed to load vendor for editing' });
  }
});

// Create vendor
router.post('/', async (req, res) => {
  try {
    // Create vendor object from form data
    const vendorData = {
      name: req.body.name,
      business_license: req.body.business_license,
      license_type: req.body.license_type,
      status: req.body.status,
      location: {
        address: req.body.address,
        coordinates: {
          latitude: parseFloat(req.body.latitude) || null,
          longitude: parseFloat(req.body.longitude) || null
        }
      },
      contact: {
        phone: req.body.phone || null,
        email: req.body.email || null,
        social: {
          instagram: req.body.instagram || null,
          facebook: req.body.facebook || null
        }
      },
      hours: JSON.parse(req.body.hours || '{}'),
      deals: JSON.parse(req.body.deals || '[]'),
      isPartner: req.body.isPartner === 'on',
      lastUpdated: new Date().toISOString()
    };
    
    // Normalize and validate
    const normalized = normalizeVendor(vendorData);
    const { error } = validateVendor(normalized);
    
    if (error) {
      return res.render('vendors/new', { 
        vendor: vendorData, 
        errors: error.details.reduce((acc, detail) => {
          acc[detail.path[0]] = detail.message;
          return acc;
        }, {})
      });
    }
    
    // Save to Firestore
    const db = getAdminDb();
    const docRef = await db.collection('vendors').add(normalized);
    
    logger.info(`Created new vendor: ${docRef.id} (${normalized.name})`);
    res.redirect(`/vendors/${docRef.id}`);
  } catch (error) {
    logger.error('Error creating vendor:', error);
    res.status(500).render('error', { error: 'Failed to create vendor' });
  }
});

// Update vendor
router.post('/:id', async (req, res) => {
  try {
    // Create vendor object from form data
    const vendorData = {
      id: req.params.id,
      name: req.body.name,
      business_license: req.body.business_license,
      license_type: req.body.license_type,
      status: req.body.status,
      location: {
        address: req.body.address,
        coordinates: {
          latitude: parseFloat(req.body.latitude) || null,
          longitude: parseFloat(req.body.longitude) || null
        }
      },
      contact: {
        phone: req.body.phone || null,
        email: req.body.email || null,
        social: {
          instagram: req.body.instagram || null,
          facebook: req.body.facebook || null
        }
      },
      hours: JSON.parse(req.body.hours || '{}'),
      deals: JSON.parse(req.body.deals || '[]'),
      isPartner: req.body.isPartner === 'on',
      lastUpdated: new Date().toISOString()
    };
    
    // Normalize and validate
    const normalized = normalizeVendor(vendorData);
    const { error } = validateVendor(normalized);
    
    if (error) {
      return res.render('vendors/edit', { 
        vendor: vendorData, 
        errors: error.details.reduce((acc, detail) => {
          acc[detail.path[0]] = detail.message;
          return acc;
        }, {})
      });
    }
    
    // Save to Firestore
    const db = getAdminDb();
    await db.collection('vendors').doc(req.params.id).set(normalized, { merge: true });
    
    logger.info(`Updated vendor: ${req.params.id} (${normalized.name})`);
    res.redirect(`/vendors/${req.params.id}`);
  } catch (error) {
    logger.error('Error updating vendor:', error);
    res.status(500).render('error', { error: 'Failed to update vendor' });
  }
});

// Delete vendor
router.post('/:id/delete', async (req, res) => {
  try {
    const db = getAdminDb();
    await db.collection('vendors').doc(req.params.id).delete();
    
    logger.info(`Deleted vendor: ${req.params.id}`);
    res.redirect('/vendors');
  } catch (error) {
    logger.error('Error deleting vendor:', error);
    res.status(500).render('error', { error: 'Failed to delete vendor' });
  }
});

module.exports = router;