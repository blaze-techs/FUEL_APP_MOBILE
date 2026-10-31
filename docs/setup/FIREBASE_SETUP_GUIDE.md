# Firebase Setup Guide for FuelPro

## Quick Setup

### Step 1: Create Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click "Add project"
3. Enter project name: `fuel-pro`
4. Disable Google Analytics (optional) and click "Create project"

### Step 2: Enable Authentication

1. In Firebase Console, go to "Authentication" → "Sign-in method"
2. Click "Email/Password"
3. Enable "Email/Password" and click "Save"
4. (Optional) Enable "Google" for Google sign-in

### Step 3: Get Configuration

1. Go to Project Settings (gear icon)
2. Scroll to "Your apps" section
3. Click web icon (`</>`) to add a web app
4. Register app with nickname "FuelPro Web"
5. Copy the config object:

```javascript
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT.firebaseio.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};
```

### Step 4: Update Vercel Environment Variables

Go to Vercel Dashboard → fuel-app-mobile → Settings → Environment Variables and update:

| Variable                          | Value                               |
| --------------------------------- | ----------------------------------- |
| VITE_FIREBASE_API_KEY             | YOUR_API_KEY                        |
| VITE_FIREBASE_AUTH_DOMAIN         | YOUR_PROJECT.firebaseapp.com        |
| VITE_FIREBASE_DATABASE_URL        | https://YOUR_PROJECT.firebaseio.com |
| VITE_FIREBASE_PROJECT_ID          | YOUR_PROJECT_ID                     |
| VITE_FIREBASE_STORAGE_BUCKET      | YOUR_PROJECT.appspot.com            |
| VITE_FIREBASE_MESSAGING_SENDER_ID | YOUR_SENDER_ID                      |
| VITE_FIREBASE_APP_ID              | YOUR_APP_ID                         |

### Step 5: Deploy and Test

1. Trigger a new deployment on Vercel
2. Once deployed, go to the app
3. Click "Create one" to register a new account
4. Use your real email and password

## Troubleshooting

### "Registration failed"

- Verify Firebase Authentication is enabled
- Check that Email/Password is enabled in Sign-in method
- Verify all environment variables are set correctly

### "Login failed"

- Same as above
- Check browser console for Firebase errors

## Firebase Admin SDK (Optional)

For server-side operations:

1. Go to Project Settings → Service accounts
2. Click "Generate new private key"
3. Save the JSON file securely
4. Add these environment variables to Vercel:

| Variable              | Value                                                        |
| --------------------- | ------------------------------------------------------------ |
| FIREBASE_PROJECT_ID   | YOUR_PROJECT_ID                                              |
| FIREBASE_CLIENT_EMAIL | firebase-adminsdk-xxxxx@YOUR_PROJECT.iam.gserviceaccount.com |
| FIREBASE_PRIVATE_KEY  | (encrypted from JSON file)                                   |
