// test-rapidapi.js
const axios = require('axios');
require('dotenv').config();

// Test address - use one from your failed addresses
const testAddress = "4901 E Blue Lupine dr, Wasilla, AK 99654";

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
    
    // Test the search endpoint (for free-form search)
    console.log("\n--- Testing /v1/search endpoint (free-form search) ---");
    
    const searchOptions = {
      method: 'GET',
      url: `https://${apiHost}/v1/search`,
      params: {
        q: testAddress,
        format: 'json',
        addressdetails: '1',
        limit: '1'
      },
      headers: {
        'X-RapidAPI-Key': apiKey,
        'X-RapidAPI-Host': apiHost
      }
    };
    
    console.log('Request URL:', searchOptions.url);
    console.log('Request params:', searchOptions.params);
    
    try {
      const searchResponse = await axios.request(searchOptions);
      
      console.log('Response status:', searchResponse.status);
      console.log('Response data type:', typeof searchResponse.data);
      console.log('Response data:', JSON.stringify(searchResponse.data, null, 2));
      
      if (searchResponse.data && Array.isArray(searchResponse.data) && searchResponse.data.length > 0) {
        const result = searchResponse.data[0];
        console.log('✅ Search endpoint successful!');
        console.log('Found coordinates:', {
          lat: result.lat,
          lon: result.lon
        });
      } else {
        console.log('❌ Search endpoint returned no results');
      }
    } catch (searchError) {
      console.error('❌ Error with search endpoint:', searchError.message);
      if (searchError.response) {
        console.error('Response status:', searchError.response.status);
        console.error('Response data:', searchError.response.data);
      }
    }
    
    // Test the forward endpoint (for structured search)
    console.log("\n--- Testing /v1/forward endpoint (structured search) ---");
    
    // Parse the address into components
    const addressParts = testAddress.split(',').map(part => part.trim());
    const street = addressParts[0];
    const city = addressParts[1] || '';
    let state = '';
    let postalcode = '';
    
    // Try to extract state and postal code
    if (addressParts[2]) {
      const stateParts = addressParts[2].trim().split(' ');
      if (stateParts.length >= 2) {
        state = stateParts[0];
        postalcode = stateParts[1];
      }
    }
    
    const forwardOptions = {
      method: 'GET',
      url: `https://${apiHost}/v1/forward`,
      params: {
        street: street,
        city: city,
        state: state,
        postalcode: postalcode,
        country: 'USA',
        format: 'json',
        addressdetails: '1',
        limit: '1'
      },
      headers: {
        'X-RapidAPI-Key': apiKey,
        'X-RapidAPI-Host': apiHost
      }
    };
    
    console.log('Request URL:', forwardOptions.url);
    console.log('Request params:', forwardOptions.params);
    
    try {
      const forwardResponse = await axios.request(forwardOptions);
      
      console.log('Response status:', forwardResponse.status);
      console.log('Response data type:', typeof forwardResponse.data);
      console.log('Response data:', JSON.stringify(forwardResponse.data, null, 2));
      
      if (forwardResponse.data && Array.isArray(forwardResponse.data) && forwardResponse.data.length > 0) {
        const result = forwardResponse.data[0];
        console.log('✅ Forward endpoint successful!');
        console.log('Found coordinates:', {
          lat: result.lat,
          lon: result.lon
        });
      } else {
        console.log('❌ Forward endpoint returned no results');
      }
    } catch (forwardError) {
      console.error('❌ Error with forward endpoint:', forwardError.message);
      if (forwardError.response) {
        console.error('Response status:', forwardError.response.status);
        console.error('Response data:', forwardError.response.data);
      }
    }
    
  } catch (error) {
    console.error('Error during RapidAPI test:', error);
  }
}

testRapidAPI();