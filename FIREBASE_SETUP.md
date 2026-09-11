# Firebase Setup Guide for FuelPro

## Overview

This document provides instructions for setting up Firebase for the FuelPro application.

## Firebase Project

- **Project ID**: `fuel-pro-1`
- **Service Account**: `firebase-adminsdk-fbsvc@fuel-pro-1.iam.gserviceaccount.com`
- **Realtime Database**: `https://fuel-pro-1.firebaseio.com`
- **Firestore**: `fuel-pro-1.firebaseapp.com`

## Environment Variables

### Client-side (VITE_ prefix)

These are already configured in Vercel:

```bash
VITE_FIREBASE_API_KEY=AIzaSyDemoKeyForFuelPro
VITE_FIREBASE_AUTH_DOMAIN=fuel-pro-1.firebaseapp.com
VITE_FIREBASE_DATABASE_URL=https://fuel-pro-1.firebaseio.com
VITE_FIREBASE_PROJECT_ID=fuel-pro-1
VITE_FIREBASE_STORAGE_BUCKET=fuel-pro-1.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123456789:web:abcdef123456
```

### Server-side (no prefix - for backend only)

These need to be set in Vercel for production:

```bash
FIREBASE_PROJECT_ID=fuel-pro-1
FIREBASE_PRIVATE_KEY="<your-private-key>"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-fbsvc@fuel-pro-1.iam.gserviceaccount.com
FIREBASE_DATABASE_URL=https://fuel-pro-1.firebaseio.com
```

## Setup Steps

### 1. Set Environment Variables in Vercel

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Select the `fuel-app-mobile` project
3. Go to Settings > Environment Variables
4. Add the Firebase Admin variables

### 2. Get Firebase Private Key

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select the `fuel-pro-1` project
3. Go to Project Settings > Service Accounts
4. Click "Generate new private key"
5. Download the JSON file

### 3. Configure Firebase Security Rules

The security rules are defined in:

- `firestore.rules` - For Firestore Database
- `database.rules.json` - For Realtime Database

### 4. Local Development Setup

1. Copy the example env file:
   ```bash
   cp .env.example .env.local
   ```
2. Add your Firebase credentials to `.env.local`

## Firebase Services Used

### Authentication

- Email/password login
- Google Sign-In
- Session management

### Database

- **Firestore**: Primary database for structured data
- **Realtime Database**: Real-time sync data

## Troubleshooting

### "Permission Denied" Errors

1. Check authentication is working
2. Verify security rules allow the operation

### Data Not Syncing

1. Verify Firebase config is correct
2. Check network connectivity
