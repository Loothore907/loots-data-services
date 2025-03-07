// vendor-processor-ui.js
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { processVendors } = require('./workflows/process-vendors');
const logger = require('./utils/logger');

// Setup file upload storage
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

// Serve static files and set view engine
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('view engine', 'ejs');

// Home page
app.get('/', (req, res) => {
  res.render('index');
});

// Process data endpoint
app.post('/process', upload.single('vendorFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const inputFile = req.file.path;
    const outputDir = path.resolve('./data/output');
    const outputFailedFile = path.join(outputDir, 'failed-geocode-' + Date.now() + '.json');
    
    // Start processing in background
    res.json({ 
      success: true, 
      message: 'Processing started',
      jobId: Date.now().toString(),
      inputFile
    });
    
    // Process after sending response (non-blocking)
    const options = {
      input: inputFile,
      output: outputFailedFile,
      mode: req.body.syncMode || 'overwrite'
    };
    
    logger.info(`Starting vendor processing job with options:`, options);
    
    const result = await processVendors(options);
    logger.info(`Processing job completed:`, result);
    
  } catch (error) {
    logger.error('Error processing vendors:', error);
    // Error already sent to client
  }
});

// Job status endpoint
app.get('/status/:jobId', (req, res) => {
  // In a real implementation, you would check job status from a queue or database
  // This is just a placeholder
  res.json({
    jobId: req.params.jobId,
    status: 'completed',
    progress: 100
  });
});

// Start server
app.listen(PORT, () => {
  logger.info(`Vendor processing UI running on http://localhost:${PORT}`);
});