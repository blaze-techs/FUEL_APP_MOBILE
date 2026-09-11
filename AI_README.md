# 🚀 FuelPro AI Agent Documentation

> **IMPORTANT**: Before making ANY changes to this repository, AI agents MUST read this file first.

---

## 📋 Table of Contents

1. [Repository Overview](#-repository-overview)
2. [Project Architecture](#-project-architecture)
3. [Tech Stack](#-tech-stack)
4. [Environment Setup](#-environment-setup)
5. [Authentication System](#-authentication-system)
6. [Cloud Services](#-cloud-services)
7. [API Endpoints](#-api-endpoints)
8. [Branches & Workflow](#-branches--workflow)
9. [Build & Deployment](#-build--deployment)
10. [Tasks Performed Log](#-tasks-performed-log)
11. [Current Issues](#-current-issues)
12. [Next Steps](#-next-steps)
13. [Plans & Roadmap](#-plans--roadmap)
14. [Access Credentials](#-access-credentials)
15. [Security Guidelines](#-security-guidelines)

## ⚠ Wrapper Freshness / Update Guarantee (non-negotiable)

## Why this exists
The .exe (Electron desktop) and .apk (Capacitor Android) wrappers load the
live site, so content updates reach users instantly — BUT app-shell updates
sometimes were buried because the wrappers were only rebuilt manually. This
section is mandatory reading for any session that touches packaging.

### The freshness rules (enforced in CI)
1. `.github/workflows/wrappers.yml` rebuilds BOTH wrappers on EVERY push to
   main AND daily on a cron, publishing to the continuously-updated
   `wrappers-latest` GitHub Release. Never rely on a manual local build —
   the CI keeps wrappers fresh automatically.
2. The desktop .exe reads its updates via `electron-updater` from the
   GitHub Releases feed. It downloads the new installer in the background
   and installs on next quit, so users never have to re-download. The
   publish config lives in `package.json` (`build.win.publish`).
3. The Android .apk loads the live site via Capacitor `server.url =
   https://fuel-app-mobile.pages.dev/` (in `capacitor.config.ts`), so its
   content is always current. Only app-shell changes require a new build,
   which the CI now publishes on every push.
4. If you must build manually, ALWAYS `npm run build` (Vite) before
   `electron-builder` / `gradlew`, and `npm ci --legacy-peer-deps` first —
   stale build caches are the #1 cause of a 'stale wrapper' report.
5. NEVER commit the `release/` output or `android/fuelpro.keystore` — they
   are gitignored (build artifacts + a self-signed sideload key). The CI
   generates its own keystore on the runner.

### Docs / user guidance to keep current
- Release page `.github/workflows/wrappers.yml` publishes
  `wrappers-latest` — point users to THAT (not the one-off v1.0.0 release).
- Play Protect block on Android: expected for a first-time self-signed cert;
  tell users 'Install anyway' is safe; a real Play listing removes it.

Remember: if you didn't rebuild the wrapper when you changed the site, the
wrapper is stale — and the CI will rebuild it on the next push anyway.

---

## 🏢 Repository Overview

| Property       | Value                                 |
| -------------- | ------------------------------------- |
| **Repository** | `fuelpropay/FUEL_APP_MOBILE`          |
| **Type**       | Fuel Station Management System (SaaS) |
| **Frontend**   | React 19 + TypeScript + Vite          |
| **Cloud**      | Firebase (Auth + Firestore)           |
| **Deployment** | Vercel (Static SPA)                   |
| **Mobile**     | Capacitor (Android/iOS)               |
| **Desktop**    | Electron (Windows/Mac/Linux)          |

---

## 🏗️ Project Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      CLIENT (Browser)                       │
├─────────────────────────────────────────────────────────────┤
│  React 19 SPA (HashRouter)                                 │
│  ├── Firebase Auth (User Authentication)                    │
│  ├── Firebase Firestore (Primary Data Storage)             │
│  ├── Local Storage (Offline Fallback)                       │
│  └── Service Worker (PWA Support)                          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    VERCEL (CDN + Edge)                      │
│  ├── Static File Hosting (dist/)                           │
│  ├── API Routes (api/)                                     │
│  └── CORS Headers (vercel.json)                            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      CLOUD SERVICES                         │
│  ├── Firebase Authentication (User Mgmt)                   │
│  ├── Firebase Firestore (Database)                          │
│  ├── Firebase Storage (File Storage)                        │
│  └── Railway (Optional - Legacy Backend)                   │
└─────────────────────────────────────────────────────────────┘
```

---

## 🛠️ Tech Stack

### Core

- **React**: 19.2.7
- **TypeScript**: 5.8.3
- **Vite**: 6.0.0
- **TailwindCSS**: 3.4.17

### State Management

- **Zustand**: 5.0.13
- **React Query**: 5.90.16
- **tRPC**: 11.8.1

### Cloud Services

- **Firebase SDK**: 12.13.0
- **Firebase Admin**: 14.2.0

### UI

- **Lucide React**: 0.510.0 (Icons)
- **Chart.js**: 4.5.1
- **Recharts**: (Graphs)

### Build Tools

- **Electron**: 42.1.0
- **Capacitor**: 8.3.4
- **Drizzle ORM**: 0.45.1

---

## 🔧 Environment Setup

### Required Environment Variables

```bash
# Firebase Client SDK (VITE_ prefix for client-side)
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_DATABASE_URL=https://your_project.firebaseio.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id

# Firebase Admin SDK (Server-side only - NO VITE_ prefix)
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."
FIREBASE_CLIENT_EMAIL=firebase-adminsdk@your_project.iam.gserviceaccount.com

# Optional: Backend API
VITE_API_URL=https://your-railway-backend.up.railway.app
```

### Local Development

```bash
# Install dependencies
npm install --legacy-peer-deps

# Run development server
npm run dev

# Build for production
npm run build:static

# Run TypeScript check
npm run check
```

---

## 🔐 Authentication System

### Primary: Firebase Authentication

**File**: `src/firebase/client.ts`

```typescript
// Initialize Firebase
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  // ...
};

// Use in components
import { getFirebaseAuth } from "@/firebase/client";
import { signInWithEmailAndPassword } from "firebase/auth";
```

### Auth Context

**File**: `src/react-app/context/AuthContext.tsx`

- Manages user authentication state
- Handles login/logout/registration
- Stores auth identity in localStorage
- BroadcastChannel for cross-tab sync

### Auth Methods

| Method         | Status       | Implementation       |
| -------------- | ------------ | -------------------- |
| Email/Password | ✅ Working   | Firebase Auth        |
| Google Sign-In | ✅ Available | Firebase Auth        |
| Demo Mode      | ❌ Removed   | Use Firebase         |
| Clerk Auth     | ❌ Removed   | Migrated to Firebase |

---

## ☁️ Cloud Services

### Firebase Configuration

**Project ID**: `fuel-pro-1`

**Client SDK**: Used in browser for user authentication and Firestore access

**Admin SDK**: Server-side operations (Vercel API routes)

### Firestore Collections

| Collection      | Purpose                    |
| --------------- | -------------------------- |
| `users`         | User profiles and settings |
| `stations`      | Fuel station data          |
| `sales`         | Sales transactions         |
| `audit_log`     | System audit trail         |
| `secrets`       | Encrypted secrets          |
| `feature_flags` | Feature toggles            |
| `config`        | Application configuration  |

---

## 🌐 API Endpoints

### Backend API (Optional - Legacy)

**Base URL**: `https://fuel-pro-backend-v2-production-7c2b.up.railway.app`

### Cloud Sync Endpoints

| Endpoint           | Method   | Purpose            |
| ------------------ | -------- | ------------------ |
| `/api/data`        | GET/POST | Cloud data sync    |
| `/api/user-data`   | GET/POST | User-specific data |
| `/api/users`       | GET      | List all users     |
| `/api/dashboard/*` | GET      | Dashboard stats    |

### tRPC Endpoints

| Router          | Purpose              |
| --------------- | -------------------- |
| `audit.*`       | Audit logging        |
| `station.*`     | Station management   |
| `sale.*`        | Sales operations     |
| `founderAuth.*` | Admin authentication |

---

## 🌿 Branches & Workflow

### Branch Organization

```
main                    # Production-ready code
├── ai-readme           # AI Agent documentation (THIS FILE)
├── develop             # Development integration
│
├── feature/            # New features
│   ├── firebase-integration
│   ├── firebase-auth-production
│   ├── firebase-firestore-real-time-sync
│   ├── cloud-sync-status-update
│   ├── pos-hardware-integration
│   └── pump-mapping-v1
│
└── fix/                # Bug fixes (archive after merge)
    ├── build-critical-errors-2026-07-28  ⬅️ LATEST FIXES
    ├── build-script-error
    ├── cloud-sync-auth-header
    ├── comprehensive-issues-analysis
    ├── comprehensive-security-performance-fixes
    ├── cross-device-sync-initialization-fix
    ├── location-indicator-text
    ├── pump-mapping-v1-auth-fix
    ├── security-critical-patches-2026
    ├── typescript-errors
    └── typescript-errors-and-build-2026-07-23
```

### Git Workflow

1. **Create feature branch**: `git checkout -b feature/my-feature`
2. **Make changes**: Implement your feature/fix
3. **Commit**: `git commit -m "description"`
4. **Push**: `git push origin feature/my-feature`
5. **PR**: Create pull request to `main`

### Naming Conventions

| Type     | Pattern                 | Example                         |
| -------- | ----------------------- | ------------------------------- |
| Feature  | `feature/name`          | `feature/new-dashboard`         |
| Fix      | `fix/issue-name`        | `fix/auth-bug`                  |
| Hotfix   | `hotfix/critical-issue` | `hotfix/security-patch`         |
| AI Agent | `ai/name-date`          | `ai/openai-integration-2026-07` |

---

## 🔨 Build & Deployment

### Build Commands

```bash
# Static build (for Vercel)
npm run build:static

# Electron build
npm run electron:build

# Capacitor build (mobile)
npm run cap:build
```

### Vercel Configuration

**File**: `vercel.json`

```json
{
  "version": 2,
  "buildCommand": "npm run build:static",
  "outputDirectory": "dist",
  "installCommand": "npm install --legacy-peer-deps",
  "framework": "vite",
  "rewrites": [
    { "source": "/((?!assets/|sw\\.js|api/).*)", "destination": "/index.html" }
  ]
}
```

### Deployment URL

- **Production**: https://fuel-app-mobile.vercel.app
- **Preview**: https://fuel-app-mobile-{branch}.vercel.app

---

## 📝 Tasks Performed Log

### 2026-07-28: Critical Build Fixes

**Branch**: `fix/build-critical-errors-2026-07-28`

| Task                      | File                                              | Action                                 |
| ------------------------- | ------------------------------------------------- | -------------------------------------- |
| CloudSyncIndicator export | `src/react-app/components/CloudSyncIndicator.tsx` | Added default export                   |
| API_URL undefined         | `src/react-app/lib/restApiSync.ts`                | Added fallback URL + apiRequest export |
| updateProfile missing     | `src/react-app/context/AuthContext.tsx`           | Added import from firebase/auth        |
| cloudSync wrapper         | `src/react-app/lib/cloudStorage.ts`               | Added compatibility wrapper            |
| PrintSettings printerId   | `src/react-app/lib/silent-print-service.ts`       | Added field to interface               |
| Clerk dependencies        | `src/react-app/hooks/useFounderAuth.ts`           | Removed (Firebase-only)                |
| Astro imports             | `api/pump-mapping/*.ts`                           | Removed framework imports              |
| Security                  | `.gitignore`                                      | Added sensitive file patterns          |

**Result**: Build ✅ PASSED, Deployment ✅ LIVE

---

### 2026-07-27: Firebase Authentication Production

**Branch**: `feature/firebase-auth-production`

| Task                  | Status |
| --------------------- | ------ |
| Remove demo mode      | ✅     |
| Firebase-only auth    | ✅     |
| Clerk removed         | ✅     |
| Production deployment | ✅     |

---

## ⚠️ Current Issues

### TypeScript Errors (61 remaining)

| Category             | Count | Impact       |
| -------------------- | ----- | ------------ |
| tRPC type mismatches | ~25   | Non-blocking |
| API type definitions | ~15   | Non-blocking |
| Legacy code cleanup  | ~21   | Non-blocking |

**Status**: Build passes, runtime works. Full TS cleanup can be done in future sprint.

### Build Warnings

- 46 npm vulnerabilities (13 moderate, 33 high)
- Some deprecated packages (uuid@9, glob@7)

---

## 📋 Next Steps

### Immediate (P0)

1. [ ] Merge `fix/build-critical-errors-2026-07-28` into `main`
2. [ ] Rotate exposed API keys (see Access Credentials)
3. [ ] Set up Vercel environment variables properly

### Short Term (P1)

1. [ ] Resolve remaining 61 TypeScript errors
2. [ ] Update npm dependencies
3. [ ] Set up proper CI/CD pipeline

### Medium Term (P2)

1. [ ] Implement full tRPC backend (if needed)
2. [ ] Add comprehensive testing
3. [ ] Set up monitoring (Sentry)

---

## 🗺️ Plans & Roadmap

### Q3 2026

- [ ] **Phase 1**: Stabilize codebase (TypeScript cleanup, testing)
- [ ] **Phase 2**: Feature completion (Pump Mapping, POS, Reports)
- [ ] **Phase 3**: Mobile app release (Capacitor)
- [ ] **Phase 4**: Multi-tenant support

### Architecture Decisions

1. **Firebase-first**: Firebase is primary data store
2. **Optional Backend**: Railway backend is optional legacy
3. **Static SPA**: Vercel hosts static files, no server-side rendering
4. **Offline-first**: LocalStorage fallback when cloud unavailable

---

## 🔑 Access Credentials

> ⚠️ **WARNING**: These are example credentials. Rotate all keys in production!

### Vercel

| Property   | Value                              |
| ---------- | ---------------------------------- |
| Team       | `leons-projects-78a92c96`          |
| Project ID | `prj_hjVrMLO7CxLTI77kthGE020eI3oj` |
| Token      | `[VERCEL_TOKEN]`                   |

### Firebase

| Property    | Value                                       |
| ----------- | ------------------------------------------- |
| Project ID  | `fuel-pro-1`                                |
| Web API Key | `[FIREBASE_API_KEY]`                        |
| Auth Domain | `fuel-pro-1.firebaseapp.com`                |
| App ID      | `1:434474929988:web:f141473bd3acfba6d41111` |

### Clerk (Deprecated)

| Property        | Value                       |
| --------------- | --------------------------- |
| Publishable Key | `[CLERK_PUBLISHABLE_KEY]`   |
| Secret Key      | `[CLERK_SECRET_KEY]`        |
| Frontend API    | `https://clerk.fuelpro.com` |

### GitHub

| Property       | Value                        |
| -------------- | ---------------------------- |
| Repository     | `fuelpropay/FUEL_APP_MOBILE` |
| Owner          | `fuel-pro`                   |
| Default Branch | `main`                       |

---

## 🔒 Security Guidelines

### For AI Agents

1. **NEVER commit secrets**: Add to `.gitignore`
2. **NEVER expose credentials**: Use environment variables
3. **NEVER push to main**: Always use feature branches
4. **ALWAYS verify**: Run `npm run check` before pushing
5. **ALWAYS test**: Run `npm run build` to verify compilation

### Sensitive Files

```gitignore
# These files should NEVER be committed
.env
.env.*
API KEYS.txt
FIREBASE BACKEND.txt
*.pem
*.key
credentials.json
service-account.json
```

### Environment Variables

| Variable Type | Prefix  | Example                 |
| ------------- | ------- | ----------------------- |
| Client-side   | `VITE_` | `VITE_FIREBASE_API_KEY` |
| Server-side   | (none)  | `FIREBASE_PRIVATE_KEY`  |

---

## 📚 Reference Documentation

### Key Files

| File                                    | Purpose                  |
| --------------------------------------- | ------------------------ |
| `src/react-app/App.tsx`                 | Main application entry   |
| `src/react-app/context/AuthContext.tsx` | Authentication state     |
| `src/firebase/client.ts`                | Firebase client config   |
| `src/firebase/admin.ts`                 | Firebase admin config    |
| `src/react-app/lib/restApiSync.ts`      | Cloud sync layer         |
| `src/react-app/lib/cloudStorage.ts`     | Cloud storage adapters   |
| `vercel.json`                           | Vercel deployment config |

### Important Patterns

1. **Firebase-first**: Always use Firebase, fallback to localStorage
2. **Singleton pattern**: Firebase instances are singletons
3. **Dynamic imports**: Avoid circular dependencies
4. **Error boundaries**: Wrap critical UI in ErrorBoundary

---

## 🤖 AI Agent Instructions

### Before Making Changes

1. Read this file (`AI_README.md`)
2. Check current branch: `git branch`
3. Pull latest: `git pull origin main`
4. Create feature branch: `git checkout -b feature/your-feature`
5. Run build check: `npm run build`

### During Development

1. Make incremental commits
2. Test locally before pushing
3. Update this file if adding new patterns
4. Document any new API endpoints

### After Completing Work

1. Push branch: `git push origin feature/your-feature`
2. Create PR to `main`
3. Wait for CI/CD checks
4. Merge after approval

### Important Commands

```bash
# Setup
npm install --legacy-peer-deps

# Development
npm run dev

# Build & Test
npm run check    # TypeScript
npm run build:static  # Production build
npm run lint    # ESLint

# Git
git checkout -b feature/your-feature
git add .
git commit -m "description"
git push origin feature/your-feature

# Deployment
vercel --prod  # Requires Vercel CLI
```

---

## 📞 Support

- **Repository**: https://github.com/fuelpropay/FUEL_APP_MOBILE
- **Issues**: https://github.com/fuelpropay/FUEL_APP_MOBILE/issues
- **Discussions**: https://github.com/fuelpropay/FUEL_APP_MOBILE/discussions

---

## 📝 Changelog

| Date       | Version | Changes                         |
| ---------- | ------- | ------------------------------- |
| 2026-07-28 | 1.0     | Initial AI README documentation |
| 2026-07-28 | 1.1     | Added task performed log        |
| 2026-07-28 | 1.2     | Updated with latest fixes       |

---

**Last Updated**: 2026-07-28  
**AI Agent Version**: 1.0  
**Maintainer**: OpenHands AI Agent
