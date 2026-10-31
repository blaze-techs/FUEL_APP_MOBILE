# Supabase Setup Guide for FuelPro

This guide walks you through setting up Supabase for the FuelPro application.

## Prerequisites

- Supabase account at https://supabase.com
- Access to the FuelPro Supabase project: `ojsscjwatikixlpshmub`

---

## 1. Run Database Schema

### Option A: Via Supabase Dashboard (Recommended)

1. Go to https://supabase.com/dashboard
2. Select your project: **Fuel_App_Pro**
3. Navigate to **SQL Editor** in the left sidebar
4. Click **New Query**
5. Copy the contents of `supabase/schema.sql`
6. Paste it into the SQL Editor
7. Click **Run** to execute

### Option B: Via Supabase CLI

```bash
# Install Supabase CLI
npm install -g supabase

# Login to Supabase
supabase login

# Link to your project
supabase link --project-ref ojsscjwatikixlpshmub

# Push the schema
supabase db push
```

---

## 2. Configure Email Templates

### 2.1 Access Email Settings

1. In Supabase Dashboard, go to **Authentication** → **Email Templates**
2. You'll see templates for:
   - Confirm signup
   - Reset password
   - Invite user

### 2.2 Customize Email Templates

#### Confirm Signup Template

```html
<h2>Welcome to FuelPro!</h2>

<p>Hi {{ .Data.Email }},</p>

<p>
  Thanks for registering with FuelPro! Please confirm your email address by
  clicking the button below:
</p>

<p style="text-align: center; margin: 30px 0;">
  <a
    href="{{ .ConfirmationURL }}"
    style="background-color: #f59e0b; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold;"
  >
    Confirm Email
  </a>
</p>

<p>Or copy this link: {{ .ConfirmationURL }}</p>

<p>If you didn't create this account, you can safely ignore this email.</p>

<p>Best regards,<br />The FuelPro Team</p>
```

#### Reset Password Template

```html
<h2>Reset Your Password</h2>

<p>Hi {{ .Data.Email }},</p>

<p>
  We received a request to reset your password. Click the button below to set a
  new password:
</p>

<p style="text-align: center; margin: 30px 0;">
  <a
    href="{{ .ConfirmationURL }}"
    style="background-color: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold;"
  >
    Reset Password
  </a>
</p>

<p>Or copy this link: {{ .ConfirmationURL }}</p>

<p>
  This link will expire in 1 hour. If you didn't request a password reset,
  please ignore this email.
</p>

<p>Best regards,<br />The FuelPro Team</p>
```

### 2.3 Email Settings Configuration

1. Go to **Authentication** → **Settings**
2. Configure:
   - **Site URL**: `https://fuel-app-mobile.vercel.app`
   - **Redirect URLs**: Add your production and preview URLs
   - **Enable email confirmations**: Yes
   - **Secure email changes**: Yes

---

## 3. Set Up Google OAuth

### 3.1 Create Google OAuth App

1. Go to https://console.cloud.google.com
2. Create a new project or select existing
3. Enable **Google+ API**
4. Go to **Credentials** → **OAuth consent screen**
5. Fill in:
   - App name: FuelPro
   - User support email: your email
   - Developer contact: your email
6. Add scopes: `email`, `profile`
7. Add test users (for development)

### 3.2 Create OAuth Credentials

1. Go to **Credentials** → **Create Credentials** → **OAuth client ID**
2. Application type: **Web application**
3. Name: FuelPro Web
4. **Authorized JavaScript origins** (required for the GIS token/popup flow — the primary, zero-config-friendly path):
   ```
   https://fuel-app-mobile.pages.dev
   https://fuel-app-mobile.vercel.app
   ```
5. **Authorized redirect URIs** (required for the OAuth redirect fallback flow):
   ```
   https://ojjscjwatikixlpshmub.supabase.co/auth/v1/callback
   ```

> The app uses a hard-coded Google OAuth client ID
> (`186024815542-fp0p5lrc6ensfg2i6o1vvf2jbnktan7f.apps.googleusercontent.com`)
> by default, configurable via `VITE_GOOGLE_CLIENT_ID`. To use your own client,
> create one above and set `VITE_GOOGLE_CLIENT_ID` in your environment.

### 3.3 Add to Supabase

1. In Supabase Dashboard, go to **Authentication** → **Providers** → **Google**
2. Enable Google provider
3. Enter your Google OAuth credentials:
   - **Client ID**: From Google Cloud Console
   - **Client Secret**: From Google Cloud Console
4. Click **Save**

---

## 4. Configure Row-Level Security (RLS)

The schema.sql file already includes RLS policies, but here's what they do:

### Stations Table

```sql
-- Users can only see/modify their own stations
CREATE POLICY "Users can view their own stations"
  ON stations FOR SELECT
  USING (auth.uid() = owner_id);
```

### Sales Table

```sql
-- Users can only access sales for their stations
CREATE POLICY "Users can view sales in their stations"
  ON sales FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM stations
      WHERE stations.id = sales.station_id
      AND stations.owner_id = auth.uid()
    )
  );
```

### Audit Log Table

```sql
-- Users can view audit logs for their stations
CREATE POLICY "Users can view audit in their stations"
  ON audit_log FOR SELECT
  USING (
    station_id IS NULL OR
    EXISTS (SELECT 1 FROM stations WHERE stations.id = audit_log.station_id AND stations.owner_id = auth.uid())
  );
```

---

## 5. Environment Variables

Add these to your Vercel project settings:

| Variable                 | Value                                      |
| ------------------------ | ------------------------------------------ |
| `VITE_SUPABASE_URL`      | `https://ojsscjwatikixlpshmub.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase anon key                     |

To get your anon key:

1. Go to **Project Settings** → **API**
2. Copy the `anon public` key

---

## 6. Test the Setup

### Test Registration

1. Go to https://fuel-app-mobile.vercel.app
2. Click "Create one"
3. Fill in details and submit
4. Check email for confirmation link

### Test Login

1. Confirm your email
2. Log in with your credentials

### Test Google OAuth

1. Click "Sign in with Google"
2. Authorize the application

---

## 7. Troubleshooting

### "Invalid API key" error

- Make sure you're using the correct project reference: `ojsscjwatikixlpshmub`
- Regenerate API keys in **Project Settings** → **API**

### Email not sending

- Check **Authentication** → **Settings** → **Site URL** is correct
- Verify email templates are configured
- Check spam folder

### RLS Policy not working

- Ensure users are authenticated
- Check that `owner_id` matches `auth.uid()`
- Test with service role key to isolate RLS issues

### Google OAuth not working

- Verify redirect URI in Google Cloud Console
- Ensure Google+ API is enabled
- Add test users for development

---

## 8. Production Checklist

- [ ] Database schema deployed
- [ ] Email templates customized
- [ ] Site URL configured
- [ ] Redirect URLs added
- [ ] Google OAuth enabled (if using)
- [ ] RLS policies verified
- [ ] Environment variables set in Vercel
- [ ] Email confirmations working
- [ ] Test user registration and login

---

## Support

For Supabase issues: https://supabase.com/docs
For FuelPro issues: Create an issue on GitHub
