const express = require('express');
const router = express.Router();
const { getAdminDb } = require('../config/firebase');
const logger = require('../utils/logger');

// Partners dashboard
router.get('/dashboard', async (req, res) => {
  try {
    const vendorId = req.query.vendor;
    let vendorData = null;
    
    if (vendorId) {
      const db = getAdminDb();
      const vendorDoc = await db.collection('vendors').doc(vendorId).get();
      
      if (vendorDoc.exists) {
        vendorData = {
          id: vendorDoc.id,
          ...vendorDoc.data()
        };
      }
    }
    
    res.render('partners/dashboard', {
      title: 'Partner Portal',
      vendorId: vendorId,
      vendor: vendorData
    });
  } catch (error) {
    logger.error('Error loading partner dashboard:', error);
    res.status(500).render('error', { error: 'Failed to load partner dashboard' });
  }
});

// Partner Portal
router.get('/portal', async (req, res) => {
  try {
    const vendorId = req.query.vendorId;
    let vendor = null;
    
    if (vendorId) {
      const db = getAdminDb();
      const vendorDoc = await db.collection('vendors').doc(vendorId).get();
      
      if (vendorDoc.exists) {
        vendor = {
          id: vendorDoc.id,
          ...vendorDoc.data()
        };
      }
    }
    
    res.render('partners/portal', { 
      vendor,
      pageTitle: vendor ? `${vendor.name} - Partner Portal` : 'Partner Portal'
    });
  } catch (error) {
    logger.error('Error accessing partner portal:', error);
    res.status(500).render('error', { error: 'Failed to access partner portal' });
  }
});

module.exports = router; 