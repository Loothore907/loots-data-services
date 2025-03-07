// test-rapidapi.js
const axios = require('axios');
require('dotenv').config();

// Test address
const testAddress = "607 Old Steese Hwy, Fairbanks, AK 99701";

async function testRapidAPI() {
  try {
    const apiKey = process.env.BACKUP_GEOCODER_API_KEY;
    const apiHost = process.env.BACKUP_GEOCODER_API_HOST || 'forward-reverse-geocoding.p.rapidapi.com';
    
    if (!apiKey || !apiHost) {
      console.error('RapidAPI key or host not configured in .env file');
      return;
    }
    
    console.log(`Testing RapidAPI geocoding for: ${testAddress}`);
    console.log(`Using host: ${apiHost}`);
    
    const options = {
      method: 'GET',
      url: `https://${apiHost}/v1/forward`,
      params: {
        address: testAddress,
        accept_language: 'en',
        polygon_threshold: '0.0'
      },
      headers: {
        'X-RapidAPI-Key': apiKey,
        'X-RapidAPI-Host': apiHost
      }
    };
    
    console.log('Sending request with options:', {
      url: options.url,
      params: options.params,
      headers: {
        'X-RapidAPI-Host': options.headers['X-RapidAPI-Host'],
        'X-RapidAPI-Key': '***API-KEY-HIDDEN***'
      }
    });
    
    const response = await axios.request(options);
    
    console.log('Response status:', response.status);
    console.log('Response data:', JSON.stringify(response.data, null, 2));
    
    if (Array.isArray(response.data) && response.data.length > 0) {
      const firstResult = response.data[0];
      console.log('\nFirst result:');
      console.log('Latitude:', firstResult.lat);
      console.log('Longitude:', firstResult.lon);
      console.log('Display name:', firstResult.display_name);
    } else {
      console.log('No results found or unexpected response format');
    }
    
  } catch (error) {
    console.error('Error during RapidAPI test:');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
      console.error('Headers:', error.response.headers);
    } else if (error.request) {
      console.error('No response received. Request:', error.request);
    } else {
      console.error('Error message:', error.message);
    }
  }
}

testRapidAPI();