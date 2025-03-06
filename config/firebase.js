// config/firebase.js
const admin = require('firebase-admin');
const { initializeApp } = require('firebase/app');
const { getFirestore } = require('firebase/firestore');
require('dotenv').config();

// Client-side Firebase configuration
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID
};

// Initialize client SDK
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Initialize Admin SDK
let adminDb = null;

function initializeAdminSDK() {
  if (adminDb) return adminDb;
  
  try {
    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    
    const adminApp = admin.initializeApp({
      credential: admin.credential.cert(require('path').resolve(serviceAccountPath))
    });
    
    adminDb = adminApp.firestore();
    return adminDb;
  } catch (error) {
    console.error('Failed to initialize Firebase Admin SDK:', error);
    throw error;
  }
}

module.exports = {
  app,
  db,
  getAdminDb: initializeAdminSDK
}; 