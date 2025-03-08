// vendor-processor-ui.js
const express = require('express');
const multer = require('multer');
const fileUpload = require('express-fileupload');
const path = require('path');
const fs = require('fs');
const logger = require('./utils/logger');

// Import routes
const vendorRoutes = require('./routes/vendors');
const workflowRoutes = require('./routes/workflows');

// Setup file upload storage for multipart forms
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.resolve('./data/input');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, 'vendors-' + Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ storage });
const app = express();
const PORT = process.env.PORT || 3000;

// Configure express-fileupload
app.use(fileUpload({
  useTempFiles: true,
  tempFileDir: '/tmp/',
  createParentPath: true,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max file size
}));

// Serve static files and set view engine
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('view engine', 'ejs');

// Dashboard home page
app.get('/', async (req, res) => {
  try {
    // Get vendors count
    const { getAdminDb } = require('./config/firebase');
    const db = getAdminDb();
    const countSnapshot = await db.collection('vendors').count().get();
    const vendorCount = countSnapshot.data().count;
    
    // Check for recent workflows
    const recentWorkflows = Array.from(global.activeWorkflows || [])
      .slice(0, 5)
      .map(([id, workflow]) => ({
        id,
        status: workflow.status,
        startTime: workflow.startTime,
        endTime: workflow.endTime
      }));
    
    // Render dashboard with stats
    res.render('dashboard', { 
      stats: {
        vendorCount,
        recentWorkflows
      } 
    });
  } catch (error) {
    logger.error('Error loading dashboard:', error);
    res.render('dashboard', { 
      stats: {
        vendorCount: 'Error',
        recentWorkflows: []
      } 
    });
  }
});

// Mount routes
app.use('/vendors', vendorRoutes);
app.use('/workflows', workflowRoutes);

// Error handler
app.use((err, req, res, next) => {
  logger.error('Server error:', err);
  res.status(500).render('error', { error: err.message });
});

// 404 handler
app.use((req, res) => {
  res.status(404).render('error', { error: 'Page not found' });
});

// Start server
app.listen(PORT, () => {
  logger.info(`Loot's Ganja Guide Admin running on http://localhost:${PORT}`);
});