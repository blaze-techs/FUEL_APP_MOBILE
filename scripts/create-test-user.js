/**
 * Firebase Admin SDK - Create Test User
 * 
 * This script creates a test user in Firebase Authentication.
 * 
 * Usage:
 *   1. Download your Firebase service account JSON from:
 *      Firebase Console → Project Settings → Service accounts → Generate new private key
 *   2. Save it as 'service-account.json' in this directory
 *   3. Run: node scripts/create-test-user.js
 */

const admin = require('firebase-admin');

// Load service account
const serviceAccount = require('../service-account.json');

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

async function createTestUser() {
  const email = 'test@fuelpro.app';
  const password = 'TestPass123456';
  const displayName = 'FuelPro Test User';

  try {
    // Create user
    const userRecord = await admin.auth().createUser({
      email: email,
      emailVerified: true,
      password: password,
      displayName: displayName,
      disabled: false
    });

    console.log('✅ Successfully created user:');
    console.log('   UID:', userRecord.uid);
    console.log('   Email:', userRecord.email);
    console.log('   Display Name:', userRecord.displayName);
    console.log('');
    console.log('You can now login with:');
    console.log('   Email:', email);
    console.log('   Password:', password);

    // Set custom claims for admin role
    await admin.auth().setCustomUserClaims(userRecord.uid, {
      role: 'admin',
      stationIds: ['*']
    });

    console.log('');
    console.log('✅ Admin role assigned!');

  } catch (error) {
    console.error('❌ Error creating user:', error.message);
    
    if (error.code === 'auth/email-already-exists') {
      console.log('');
      console.log('User already exists. You can login with:');
      console.log('   Email:', email);
      console.log('   Password:', password);
    }
  }

  process.exit();
}

createTestUser();
