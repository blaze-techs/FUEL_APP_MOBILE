# FuelPro - Fuel Management System

![FuelPro Logo](public/logo-small.jpg)

A comprehensive fuel station management system built with React, Supabase, and modern web technologies.

## 🚀 Features

- **Multi-Station Management**: Manage unlimited fuel stations from a single dashboard
- **Real-time Sales Tracking**: Live sales, delivery & payment tracking
- **Inventory Management**: Track fuel levels, set alerts, and manage restocking
- **EPRA Compliance**: Built-in compliance tools for regulatory requirements
- **Cloud Sync**: Real-time synchronization across all devices
- **PWA Support**: Install as a desktop or mobile app
- **Offline Mode**: Continue working even without internet
- **Analytics Dashboard**: Comprehensive insights and reporting
- **POS System**: Fast point-of-sale for quick fuel sales
- **Credit Management**: Track customer credit and payments
- **Multi-Payment Support**: Cash, M-PESA, Bank transfers, and more

## 🛠️ Tech Stack

| Category         | Technology                 |
| ---------------- | -------------------------- |
| Frontend         | React 18, TypeScript, Vite |
| State Management | Zustand                    |
| Styling          | Tailwind CSS               |
| Charts           | Chart.js, react-chartjs-2  |
| Database         | Supabase (PostgreSQL)      |
| Authentication   | Supabase Auth              |
| API              | tRPC, REST                 |
| Mobile           | Capacitor                  |
| PWA              | Workbox, Vite PWA Plugin   |
| Testing          | Vitest, Playwright         |
| Error Tracking   | Sentry                     |

## 📦 Installation

```bash
# Clone the repository
git clone https://github.com/fuelpropay/FUEL_APP_MOBILE.git
cd FUEL_APP_MOBILE

# Install dependencies
npm install --legacy-peer-deps

# Start development server
npm run dev

# Build for production
npm run build:static
```

## ⚙️ Environment Variables

Create a `.env` file in the root directory:

```env
# Supabase Configuration
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key

# Optional: Backend API
VITE_BACKEND_URL=https://your-backend.com
VITE_TRPC_URL=https://your-backend.com/api/trpc
```

See `.env.example` for all available options.

## 🗄️ Database Setup

1. Create a Supabase project at [supabase.com](https://supabase.com)
2. Run the database schema in SQL Editor:

```sql
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Run the schema from database_schema.sql
-- ... (see database_schema.sql for full schema)
```

## 🚀 Deployment

### Vercel (Recommended)

1. Connect your GitHub repository to Vercel
2. Configure environment variables in Vercel dashboard
3. Deploy!

```bash
# Using Vercel CLI
npm install -g vercel
vercel
vercel --prod
```

### GitHub Actions

The repository includes CI/CD workflows:

- `.github/workflows/ci.yml` - Lint, Type Check, Test, Build
- `.github/workflows/deploy.yml` - Auto-deploy on push to main

## 🧪 Testing

```bash
# Run unit tests
npm run test

# Run E2E tests
npx playwright test

# Run with coverage
npm run test -- --coverage
```

## 📱 Mobile App

Build native mobile apps using Capacitor:

```bash
# Initialize Capacitor
npm run cap:init

# Add iOS
npx cap add ios

# Add Android
npm run cap:add:android

# Sync web app
npm run cap:sync

# Build & Open in Android Studio
npm run cap:build
```

## 📂 Project Structure

```
FUEL_APP_MOBILE/
├── src/
│   ├── react-app/           # Main React application
│   │   ├── components/       # Reusable UI components
│   │   ├── pages/           # Page components
│   │   ├── context/         # React contexts
│   │   ├── hooks/           # Custom React hooks
│   │   ├── lib/             # Utility libraries
│   │   └── config/          # Configuration files
│   ├── supabase/           # Supabase client
│   ├── providers/            # App providers
│   ├── hooks/               # Shared hooks
│   ├── utils/               # Utility functions
│   └── test/                # Test utilities
├── public/                  # Static assets
├── docs/                   # Documentation
├── api/                    # API routes
└── e2e/                   # E2E tests
```

## 🔒 Security

- **Row Level Security (RLS)**: All database tables have RLS enabled
- **Environment Variables**: Sensitive values stored in Vercel environment
- **HTTPS Only**: All communications are encrypted
- **CORS**: Configured for specific origins only

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

## 📄 License

MIT License - see LICENSE file for details.

## 🙏 Acknowledgments

- [Supabase](https://supabase.com) - Backend infrastructure
- [Vercel](https://vercel.com) - Hosting and deployment
- [React](https://react.dev) - UI framework
- [Tailwind CSS](https://tailwindcss.com) - Styling

## 📞 Support

- **Email**: support@fuelpro.com
- **Documentation**: [docs/](docs/)
- **Issues**: [GitHub Issues](https://github.com/fuelpropay/FUEL_APP_MOBILE/issues)

---

Built with ❤️ by the FuelPro Team
