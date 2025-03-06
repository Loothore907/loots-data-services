# Loot's Ganja Guide Data Services

A modular toolkit for managing and enriching vendor data for the Loot's Ganja Guide cannabis app.

## Features

- Import vendor data from various sources
- Geocode addresses to obtain precise coordinates
- Validate and normalize data against app schema
- Sync data with Firebase Firestore database

## Getting Started

### Prerequisites

- Node.js 14+
- Firebase project with Firestore
- Service account credentials

### Installation

```
npm install
cp .env.example .env
# Edit .env with your credentials
```

### Running Services

```
# Geocode vendor addresses
npm run geocode -- --input=./data/input/vendors.json --output=./data/output/geocoded-vendors.json

# Sync with Firebase
npm run sync -- --input=./data/output/geocoded-vendors.json
```

## Project Structure

The project follows a modular architecture with independent services:

- `services/`: Core service modules
- `workflows/`: Composed service workflows
- `config/`: Configuration files
- `models/`: Data models and schemas
- `utils/`: Shared utilities
- `data/`: Local data storage
- `scripts/`: CLI scripts

## License

This project is private and proprietary. 