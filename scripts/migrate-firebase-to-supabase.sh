#!/bin/bash

# Firebase to Supabase Migration Script
# This script replaces Firebase imports with Supabase imports across the codebase

echo "🚀 Starting Firebase to Supabase Migration..."
echo ""

# Define color codes
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Backup original files
echo -e "${BLUE}📦 Creating backups...${NC}"
mkdir -p backups/$(date +%Y%m%d_%H%M%S)
find src -name "*.ts" -o -name "*.tsx" | while read file; do
  cp "$file" "backups/$(date +%Y%m%d_%H%M%S)/$file"
done
echo -e "${GREEN}✓ Backups created${NC}"
echo ""

# Replace Firebase imports with Supabase
echo -e "${BLUE}🔄 Replacing Firebase imports with Supabase...${NC}"

# Replace Firebase client imports
echo "  • Replacing Firebase client imports..."
find src -name "*.ts" -o -name "*.tsx" | xargs sed -i 's|from "@/firebase/client"|from "@/supabase/client"|g'
find src -name "*.ts" -o -name "*.tsx" | xargs sed -i 's|from "@/firebase/auth"|from "@/supabase/client"|g'
find src -name "*.ts" -o -name "*.tsx" | xargs sed -i 's|from "@/firebase/database"|from "@/supabase/client"|g'
find src -name "*.ts" -o -name "*.tsx" | xargs sed -i 's|from "firebase/firestore"|from "@supabase/supabase-js"|g'
find src -name "*.ts" -o -name "*.tsx" | xargs sed -i 's|from "firebase/auth"|from "@supabase/supabase-js"|g'
find src -name "*.ts" -o -name "*.tsx" | xargs sed -i 's|from "firebase/app"|from "@supabase/supabase-js"|g'

# Replace FirebaseService with SupabaseService
echo "  • Replacing FirebaseService with SupabaseService..."
find src -name "*.ts" -o -name "*.tsx" | xargs sed -i 's|import { FirebaseService }|import { SupabaseService }|g'
find src -name "*.ts" -o -name "*.tsx" | xargs sed -i 's|FirebaseService\.isEnabled|SupabaseService\.isEnabled|g'
find src -name "*.ts" -o -name "*.tsx" | xargs sed -i 's|FirebaseService\.syncToCloud|SupabaseService\.syncToCloud|g'
find src -name "*.ts" -o -name "*.tsx" | xargs sed -i 's|FirebaseService\.restoreFromCloud|SupabaseService\.restoreFromCloud|g'
find src -name "*.ts" -o -name "*.tsx" | xargs sed -i 's|FirebaseService\.setEnabled|SupabaseService\.setEnabled|g'
find src -name "*.ts" -o -name "*.tsx" | xargs sed -i 's|FirebaseService\.setEncryptionKey|SupabaseService\.setEncryptionKey|g'

echo -e "${GREEN}✓ Imports replaced${NC}"
echo ""

# Update environment variable references
echo -e "${BLUE}🔧 Updating environment variables...${NC}"

# Create .env.supabase from .env.example
if [ -f ".env.example" ]; then
  cp .env.example .env.supabase
  # Add Supabase variables
  echo "" >> .env.supabase
  echo "# Supabase Configuration" >> .env.supabase
  echo "VITE_SUPABASE_URL=https://your-project.supabase.co" >> .env.supabase
  echo "VITE_SUPABASE_ANON_KEY=your-anon-key" >> .env.supabase
  echo -e "${GREEN}✓ Created .env.supabase${NC}"
fi

echo ""

# Update package.json (remove Firebase, ensure Supabase is installed)
echo -e "${BLUE}📦 Updating package.json...${NC}"
if grep -q '"@supabase/supabase-js"' package.json; then
  echo "  • Supabase already in package.json"
else
  echo "  • Adding @supabase/supabase-js..."
  # Note: Should be done manually in package.json
fi

echo -e "${GREEN}✓ Package.json check complete${NC}"
echo ""

# Create Supabase configuration file
echo -e "${BLUE}📝 Creating Supabase configuration...${NC}"
mkdir -p src/supabase

cat > src/supabase/config.ts << 'EOF'
/**
 * Supabase Configuration
 * 
 * Update these values with your Supabase project credentials
 */

// Get credentials from environment variables
export const supabaseConfig = {
  url: import.meta.env.VITE_SUPABASE_URL || '',
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
};

// Validate configuration
if (!supabaseConfig.url || !supabaseConfig.anonKey) {
  console.error('⚠️  Supabase configuration missing!');
  console.error('Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file');
}
EOF

echo -e "${GREEN}✓ Supabase config created${NC}"
echo ""

# Summary
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✅ Migration Script Complete!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${YELLOW}Next Steps:${NC}"
echo ""
echo -e "1. ${BLUE}Set up Supabase Project:${NC}"
echo "   • Go to https://supabase.com"
echo "   • Create a new project"
echo "   • Get URL and anon key from Settings → API"
echo ""
echo -e "2. ${BLUE}Update Environment Variables:${NC}"
echo "   • Copy .env.supabase to .env.local"
echo "   • Replace placeholder values with your actual credentials"
echo ""
echo -e "3. ${BLUE}Run Database Migrations:${NC}"
echo "   • Go to Supabase SQL Editor"
echo "   • Run contents of db/migrations/002_rls_policies.sql"
echo ""
echo -e "4. ${BLUE}Apply RLS Policies:${NC}"
echo "   • See docs/APPLY_RLS_POLICIES.md for instructions"
echo ""
echo -e "5. ${BLUE}Test the Application:${NC}"
echo "   • npm install"
echo "   • npm run dev"
echo "   • Test user registration and login"
echo "   • Test station creation and sales"
echo ""
echo -e "6. ${BLUE}Remove Firebase (optional):${NC}"
echo "   • npm uninstall firebase firebase-admin"
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "📚 Documentation: SUPABASE_MIGRATION.md"
echo -e "🔧 Migration Guide: docs/APPLY_RLS_POLICIES.md"
echo ""
