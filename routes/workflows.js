// routes/workflows.js
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const logger = require('../utils/logger');

// Store active workflow processes and their logs
const activeWorkflows = new Map();

// List available workflows
router.get('/', (req, res) => {
  // Define available workflows with their configurations
  const workflows = [
    {
      id: 'import',
      name: 'Import & Normalize Vendors',
      description: 'Import vendor data from JSON/CSV and normalize to the app schema',
      script: 'scripts/import-vendors.js',
      params: [
        { name: 'input', label: 'Input File', type: 'file', required: true }
      ]
    },
    {
      id: 'geocode',
      name: 'Geocode Vendors',
      description: 'Geocode vendor addresses to obtain coordinates',
      script: 'scripts/geocode-vendors.js',
      params: [
        { name: 'input', label: 'Input File', type: 'file', required: true },
        { name: 'output', label: 'Output File', type: 'text', default: './data/output/geocoded-vendors.json' },
        { name: 'concurrency', label: 'Concurrency', type: 'number', default: 2 },
        { name: 'delay', label: 'Delay (ms)', type: 'number', default: 200 },
        { name: 'skip-existing', label: 'Skip Existing Coordinates', type: 'checkbox', default: true }
      ]
    },
    {
      id: 'process-priority',
      name: 'Process Priority Regions',
      description: 'Process vendors in priority regions with address cleaning and validation',
      script: 'scripts/process-vendors-regions.js',
      params: [
        { name: 'input', label: 'Input File', type: 'file', required: true },
        { name: 'output', label: 'Output File', type: 'text', default: './data/output/priority_vendors_latest.json' }
      ]
    },
    {
      id: 'sync',
      name: 'Sync to Firebase',
      description: 'Sync processed vendor data to Firebase Firestore',
      script: 'scripts/sync-firebase.js',
      params: [
        { name: 'input', label: 'Input File', type: 'file', required: true },
        { name: 'collection', label: 'Collection Name', type: 'text', default: 'vendors' },
        { name: 'batch-size', label: 'Batch Size', type: 'number', default: 500 },
        { name: 'merge', label: 'Merge with Existing', type: 'checkbox', default: true }
      ]
    },
    {
      id: 'clear-vendors',
      name: 'Clear Vendors Collection',
      description: 'Delete all vendors from the Firestore collection (use with caution)',
      script: 'clear-vendors.js',
      params: []
    }
  ];
  
  res.render('workflows/index', { workflows });
});

// Show workflow execution form
router.get('/:id', (req, res) => {
  // Find the requested workflow
  const workflows = [
    {
      id: 'import',
      name: 'Import & Normalize Vendors',
      description: 'Import vendor data from JSON/CSV and normalize to the app schema',
      script: 'scripts/import-vendors.js',
      params: [
        { name: 'input', label: 'Input File', type: 'file', required: true }
      ]
    },
    {
      id: 'geocode',
      name: 'Geocode Vendors',
      description: 'Geocode vendor addresses to obtain coordinates',
      script: 'scripts/geocode-vendors.js',
      params: [
        { name: 'input', label: 'Input File', type: 'file', required: true },
        { name: 'output', label: 'Output File', type: 'text', default: './data/output/geocoded-vendors.json' },
        { name: 'concurrency', label: 'Concurrency', type: 'number', default: 2 },
        { name: 'delay', label: 'Delay (ms)', type: 'number', default: 200 },
        { name: 'skip-existing', label: 'Skip Existing Coordinates', type: 'checkbox', default: true }
      ]
    },
    {
      id: 'process-priority',
      name: 'Process Priority Regions',
      description: 'Process vendors in priority regions with address cleaning and validation',
      script: 'scripts/process-vendors-regions.js',
      params: [
        { name: 'input', label: 'Input File', type: 'file', required: true },
        { name: 'output', label: 'Output File', type: 'text', default: './data/output/priority_vendors_latest.json' }
      ]
    },
    {
      id: 'sync',
      name: 'Sync to Firebase',
      description: 'Sync processed vendor data to Firebase Firestore',
      script: 'scripts/sync-firebase.js',
      params: [
        { name: 'input', label: 'Input File', type: 'file', required: true },
        { name: 'collection', label: 'Collection Name', type: 'text', default: 'vendors' },
        { name: 'batch-size', label: 'Batch Size', type: 'number', default: 500 },
        { name: 'merge', label: 'Merge with Existing', type: 'checkbox', default: true }
      ]
    },
    {
      id: 'clear-vendors',
      name: 'Clear Vendors Collection',
      description: 'Delete all vendors from the Firestore collection (use with caution)',
      script: 'clear-vendors.js',
      params: []
    }
  ];
  
  const workflow = workflows.find(w => w.id === req.params.id);
  
  if (!workflow) {
    return res.status(404).render('error', { error: 'Workflow not found' });
  }
  
  // Check if workflow is currently running
  const isRunning = activeWorkflows.has(workflow.id);
  
  res.render('workflows/execute', { 
    workflow,
    isRunning,
    logs: isRunning ? activeWorkflows.get(workflow.id).logs : []
  });
});

// Execute workflow
router.post('/:id/execute', async (req, res) => {
  // Find the requested workflow
  const workflows = [
    {
      id: 'import',
      name: 'Import & Normalize Vendors',
      description: 'Import vendor data from JSON/CSV and normalize to the app schema',
      script: 'scripts/import-vendors.js',
      params: [
        { name: 'input', label: 'Input File', type: 'file', required: true }
      ]
    },
    {
      id: 'geocode',
      name: 'Geocode Vendors',
      description: 'Geocode vendor addresses to obtain coordinates',
      script: 'scripts/geocode-vendors.js',
      params: [
        { name: 'input', label: 'Input File', type: 'file', required: true },
        { name: 'output', label: 'Output File', type: 'text', default: './data/output/geocoded-vendors.json' },
        { name: 'concurrency', label: 'Concurrency', type: 'number', default: 2 },
        { name: 'delay', label: 'Delay (ms)', type: 'number', default: 200 },
        { name: 'skip-existing', label: 'Skip Existing Coordinates', type: 'checkbox', default: true }
      ]
    },
    {
      id: 'process-priority',
      name: 'Process Priority Regions',
      description: 'Process vendors in priority regions with address cleaning and validation',
      script: 'scripts/process-vendors-regions.js',
      params: [
        { name: 'input', label: 'Input File', type: 'file', required: true },
        { name: 'output', label: 'Output File', type: 'text', default: './data/output/priority_vendors_latest.json' }
      ]
    },
    {
      id: 'sync',
      name: 'Sync to Firebase',
      description: 'Sync processed vendor data to Firebase Firestore',
      script: 'scripts/sync-firebase.js',
      params: [
        { name: 'input', label: 'Input File', type: 'file', required: true },
        { name: 'collection', label: 'Collection Name', type: 'text', default: 'vendors' },
        { name: 'batch-size', label: 'Batch Size', type: 'number', default: 500 },
        { name: 'merge', label: 'Merge with Existing', type: 'checkbox', default: true }
      ]
    },
    {
      id: 'clear-vendors',
      name: 'Clear Vendors Collection',
      description: 'Delete all vendors from the Firestore collection (use with caution)',
      script: 'clear-vendors.js',
      params: []
    }
  ];
  
  const workflow = workflows.find(w => w.id === req.params.id);
  
  if (!workflow) {
    return res.status(404).json({ success: false, error: 'Workflow not found' });
  }
  
  try {
    // Check if workflow is already running
    if (activeWorkflows.has(workflow.id)) {
      return res.status(409).json({ 
        success: false, 
        error: 'Workflow already running', 
        jobId: workflow.id 
      });
    }
    
    // Build command arguments
    const args = [];
    
    // Handle file upload if needed
    let uploadedFilePath = null;
    if (req.files && req.files.input) {
      const uploadedFile = req.files.input;
      const inputDir = path.resolve('./data/input');
      
      // Ensure the input directory exists
      if (!fs.existsSync(inputDir)) {
        fs.mkdirSync(inputDir, { recursive: true });
      }
      
      // Save the file
      const filePath = path.join(inputDir, uploadedFile.name);
      await uploadedFile.mv(filePath);
      uploadedFilePath = filePath;
      
      // Add to args
      args.push('--input', filePath);
    }
    
    // Add other parameters
    workflow.params.forEach(param => {
      if (param.name !== 'input' || !uploadedFilePath) {
        const paramValue = req.body[param.name];
        
        if (paramValue !== undefined && paramValue !== '') {
          if (param.type === 'checkbox') {
            if (paramValue === 'on') {
              args.push(`--${param.name}`);
            } else {
              args.push(`--no-${param.name}`);
            }
          } else {
            args.push(`--${param.name}`, paramValue);
          }
        }
      }
    });
    
    // Start the workflow process
    const process = spawn('node', [workflow.script, ...args]);
    
    // Create a workflow execution record
    const workflowExecution = {
      id: workflow.id,
      startTime: new Date(),
      status: 'running',
      logs: [],
      process
    };
    
    // Store in active workflows
    activeWorkflows.set(workflow.id, workflowExecution);
    
    // Collect output
    process.stdout.on('data', (data) => {
      const logLine = data.toString().trim();
      if (logLine) {
        workflowExecution.logs.push({ time: new Date(), type: 'info', text: logLine });
        logger.info(`[Workflow ${workflow.id}] ${logLine}`);
      }
    });
    
    process.stderr.on('data', (data) => {
      const logLine = data.toString().trim();
      if (logLine) {
        workflowExecution.logs.push({ time: new Date(), type: 'error', text: logLine });
        logger.error(`[Workflow ${workflow.id}] ${logLine}`);
      }
    });
    
    // Handle process completion
    process.on('close', (code) => {
      workflowExecution.status = code === 0 ? 'completed' : 'failed';
      workflowExecution.endTime = new Date();
      workflowExecution.exitCode = code;
      
      // Keep record for a while, then clean up
      setTimeout(() => {
        activeWorkflows.delete(workflow.id);
      }, 3600000); // 1 hour
      
      logger.info(`Workflow ${workflow.id} ${workflowExecution.status} with exit code ${code}`);
    });
    
    // Send the immediate response
    res.json({ 
      success: true, 
      message: 'Workflow started', 
      jobId: workflow.id 
    });
    
  } catch (error) {
    logger.error('Error executing workflow:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get workflow status and logs
router.get('/:id/status', (req, res) => {
  const workflowId = req.params.id;
  const execution = activeWorkflows.get(workflowId);
  
  if (!execution) {
    return res.status(404).json({ success: false, error: 'No active workflow found with this ID' });
  }
  
  // Get the logs after a specific timestamp if provided
  let logs = execution.logs;
  if (req.query.after) {
    const afterTime = new Date(req.query.after);
    logs = logs.filter(log => new Date(log.time) > afterTime);
  }
  
  res.json({
    success: true,
    workflow: {
      id: execution.id,
      status: execution.status,
      startTime: execution.startTime,
      endTime: execution.endTime,
      exitCode: execution.exitCode
    },
    logs
  });
});

module.exports = router;