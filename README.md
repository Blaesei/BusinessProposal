# STLAF Proposals Management System

## Overview
A professional proposal management system for Sadsad Tamesis Legal and Accountancy Firm.

## Setup Instructions
1. Install dependencies: `npm install`
2. Configure environment variables (see `.env.example`).
3. Run in development: `npm run dev`
4. Build for production: `npm run build`

## Project Structure
- `src/models`: Data models and types.
- `src/views`: React components and pages.
- `src/services`: Firebase and Google API integrations.
- `src/utils`: Utility functions.
- `src/config`: Constants and configuration.

## API Documentation
The backend (Express) provides several endpoints for Google Docs integration:
- `POST /api/generate-proposal`: Generates a proposal doc from a template.
- `POST /api/send-email`: Sends the generated proposal as a PDF via Gmail.
- `GET /api/debug/auth-url`: Generates a Google OAuth authorization URL.
- `GET /api/debug/auth-callback`: Handles OAuth callback and provides a refresh token.

## Roles
- **Admins**: damoncrz2872@gmail.com, stlaf.acc08@gmail.com
- **Staff**: mike.paras272@gmail.com, stlaf.acc07@gmail.com, dcpebenito@sadsadtamesislaw.com
