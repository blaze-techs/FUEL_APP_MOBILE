# Firebase to Supabase Migration Guide

## Overview

This guide explains how to migrate the FuelPro application from Firebase to Supabase.

## Migration Steps

### Step 1: Update Environment Variables

Replace Firebase environment variables with Supabase:

```bash
# Remove Firebase variables
# VITE_FIREBASE_API_KEY
# VITE_FIREBASE_AUTH_DOMAIN
# VITE_FIREBASE_DATABASE_URL
# VITE_FIREBASE_PROJECT_ID
# VITE_FIREBASE_STORAGE_BUCKET
# VITE_FIREBASE_MESSAGING_SENDER_ID
# VITE_FIREBASE_APP_ID
# VITE_FIREBASE_MEASUREMENT_ID

# Add Supabase variables
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### Step 2: Install Dependencies

Supabase SDK is already installed. If not:

```bash
npm install @supabase/supabase-js
```

### Step 3: Update Code

#### Replace Firebase imports with Supabase:

**Before (Firebase):**

```typescript
import { getFirebaseAuth } from "@/firebase/client";
import { FirebaseService } from "@/react-app/services/FirebaseService";
```

**After (Supabase):**

```typescript
import { supabase } from "@/supabase/client";
import { SupabaseService } from "@/supabase/SupabaseService";
```

#### Update Authentication:

**Before (Firebase):**

```typescript
const auth = getFirebaseAuth();
await signInWithEmailAndPassword(auth, email, password);
```

**After (Supabase):**

```typescript
const { user, error } = await supabase.auth.signInWithPassword({
  email,
  password,
});
```

#### Update Data Operations:

**Before (Firebase):**

```typescript
const db = getFirestore();
await setDoc(doc(db, "stations", stationId), data);
```

**After (Supabase):**

```typescript
const { data, error } = await supabase.from("stations").upsert(data);
```

### Step 4: Create Supabase Tables

Run the database migration in Supabase SQL Editor:

```sql
-- See db/migrations/002_rls_policies.sql for complete schema
```

### Step 5: Apply RLS Policies

See `docs/APPLY_RLS_POLICIES.md` for instructions.

### Step 6: Test

Test all functionality:

- User registration and login
- Station creation
- Fuel sales
- Admin dashboard
- Cloud sync

## Files to Update

### Replace:

- `src/firebase/client.ts` → `src/supabase/client.ts` (created)
- `src/firebase/SupabaseService.ts` → `src/supabase/SupabaseService.ts` (created)
- Update `src/react-app/context/AuthContext.tsx`
- Update `src/react-app/services/FirebaseService.ts`
- Update any files importing Firebase

### Environment Variables

Create `.env.local`:

```
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

## Supabase Project Setup

1. Create project at https://supabase.com
2. Get URL and anon key from Settings → API
3. Run database migrations
4. Enable Row Level Security
5. Configure authentication settings

## Troubleshooting

### "Supabase not configured"

- Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set
- Verify environment variables are loaded

### "Permission denied"

- Check RLS policies are applied
- Verify user is authenticated
- Check Supabase auth settings

### Auth errors

- Verify email confirmation settings in Supabase
- Check authentication methods enabled

## Support

For more help, see Supabase documentation:

- https://supabase.com/docs
- https://supabase.com/docs/guides/auth
- https://supabase.com/docs/guides/database
