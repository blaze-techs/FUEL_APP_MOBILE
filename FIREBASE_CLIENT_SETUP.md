# Firebase Client SDK Setup Guide

## Step 1: Get Firebase Client SDK Configuration

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project: **fuel-pro-1**
3. Click the **gear icon** (⚙️) → **Project Settings**
4. Scroll down to **"Your apps"** section
5. If you see a web app, click on it. If not, click **"Add app"** → **Web** (</>) and register your app
6. Copy the **firebaseConfig** object - it looks like this:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSy....................",
  authDomain: "fuel-pro-1.firebaseapp.com",
  databaseURL: "https://fuel-pro-1.firebaseio.com",
  projectId: "fuel-pro-1",
  storageBucket: "fuel-pro-1.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef123456",
};
```

## Step 2: Update Vercel Environment Variables

After getting your Firebase Client SDK config, update these Vercel environment variables:

| Variable                            | Value                                    |
| ----------------------------------- | ---------------------------------------- |
| `VITE_FIREBASE_API_KEY`             | The `apiKey` from your config            |
| `VITE_FIREBASE_AUTH_DOMAIN`         | The `authDomain` from your config        |
| `VITE_FIREBASE_DATABASE_URL`        | The `databaseURL` from your config       |
| `VITE_FIREBASE_PROJECT_ID`          | The `projectId` from your config         |
| `VITE_FIREBASE_STORAGE_BUCKET`      | The `storageBucket` from your config     |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | The `messagingSenderId` from your config |
| `VITE_FIREBASE_APP_ID`              | The `appId` from your config             |

## Step 3: Enable Email/Password Authentication

1. In Firebase Console, go to **Authentication** → **Sign-in method**
2. Click **"Email/Password"**
3. Enable **"Email/Password"**
4. Optionally enable **"Email link (passwordless sign-in)"**
5. Click **Save**

## Step 4: Add Test User

1. In Firebase Console, go to **Authentication** → **Users**
2. Click **"Add user"**
3. Enter email and password
4. Click **Add user**

## Verification

After setup, try registering a new account on the app. It should work with Firebase Authentication.

## Troubleshooting

### "Registration failed"

- Check that Email/Password is enabled in Firebase Console
- Verify the API key is correct (not the demo key)
- Check browser console for specific Firebase errors

### "Firebase configuration error"

- The API key is still set to the demo value
- Update VITE_FIREBASE_API_KEY with the real API key from Firebase Console

### "App not authorized"

- Check that the domain is authorized in Firebase Console → Authentication → Settings → Authorized domains
