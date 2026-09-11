# FuelPro API Documentation

## Overview

FuelPro uses Supabase as its backend, providing:
- **Authentication**: Email/Password, OAuth
- **Database**: PostgreSQL with Row Level Security (RLS)
- **Real-time**: Subscriptions for live updates
- **Storage**: File uploads

## Base URLs

| Environment | URL |
|------------|-----|
| Production | `https://ojsscjwatikixlpshmub.supabase.co` |
| API Key Header | `apikey: YOUR_ANON_KEY` |

## Authentication

### Login
```http
POST /auth/v1/token?grant_type=password
Content-Type: application/json
apikey: YOUR_ANON_KEY

{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "access_token": "eyJ...",
  "refresh_token": "...",
  "expires_in": 3600,
  "expires_at": 1234567890,
  "user": {
    "id": "uuid",
    "email": "user@example.com"
  }
}
```

### Register
```http
POST /auth/v1/signup
Content-Type: application/json
apikey: YOUR_ANON_KEY

{
  "email": "user@example.com",
  "password": "password123",
  "data": {
    "full_name": "John Doe"
  }
}
```

## Database Tables

### users
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key (references auth.users) |
| name | TEXT | User's display name |
| email | TEXT | User's email |
| role | TEXT | 'user', 'admin', 'founder' |
| user_status | TEXT | 'active', 'suspended', 'banned' |
| country_code | VARCHAR(2) | ISO country code |
| phone | VARCHAR(50) | Phone number |
| created_at | TIMESTAMPTZ | Creation timestamp |

### stations
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| name | TEXT | Station name |
| code | TEXT | Unique station code |
| location | TEXT | Physical address |
| latitude | DECIMAL | GPS latitude |
| longitude | DECIMAL | GPS longitude |
| country | TEXT | Country name |
| country_code | VARCHAR(2) | ISO country code |
| status | TEXT | 'active', 'inactive', 'maintenance' |
| tax_rate | DECIMAL(5,2) | Tax rate percentage |

### station_users
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| station_id | UUID | References stations |
| user_id | UUID | References users |
| role | TEXT | 'owner', 'manager', 'cashier', 'viewer' |
| is_active | BOOLEAN | Active status |

### inventory
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| station_id | UUID | References stations |
| fuel_type | TEXT | 'petrol', 'diesel', 'premium', 'kerosene', 'lpg' |
| current_stock | DECIMAL | Current stock in liters |
| capacity | DECIMAL | Tank capacity |
| price_per_liter | DECIMAL | Selling price |
| cost_per_liter | DECIMAL | Purchase cost |
| alert_threshold | DECIMAL | Low stock alert level |

### sales
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| station_id | UUID | References stations |
| user_id | UUID | References users |
| fuel_type | TEXT | Type of fuel sold |
| quantity_liters | DECIMAL | Amount sold |
| price_per_liter | DECIMAL | Price at time of sale |
| subtotal | DECIMAL | Total before tax |
| tax_amount | DECIMAL | Tax amount |
| total | DECIMAL | Final total |
| payment_method | VARCHAR | Payment method used |
| pump_number | VARCHAR | Pump number |
| receipt_number | VARCHAR | Receipt number |

### audit_logs
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| user_id | UUID | References users |
| station_id | UUID | References stations |
| event | TEXT | Event type |
| detail | TEXT | Event details |
| severity | TEXT | 'info', 'success', 'warning', 'danger' |

## API Examples

### Get Stations
```http
GET /rest/v1/stations?select=*
apikey: YOUR_ANON_KEY
Authorization: Bearer YOUR_ACCESS_TOKEN
```

### Create Sale
```http
POST /rest/v1/sales
apikey: YOUR_ANON_KEY
Authorization: Bearer YOUR_ACCESS_TOKEN
Content-Type: application/json
Prefer: return=representation

{
  "station_id": "uuid",
  "fuel_type": "petrol",
  "quantity_liters": 10.5,
  "price_per_liter": 1.50,
  "payment_method": "cash"
}
```

### Update Inventory
```http
PATCH /rest/v1/inventory?id=eq.uuid
apikey: YOUR_ANON_KEY
Authorization: Bearer YOUR_ACCESS_TOKEN
Content-Type: application/json
Prefer: return=representation

{
  "current_stock": 500.0
}
```

## Row Level Security (RLS)

All tables have RLS enabled. Policies ensure:
- Users can only see their own data
- Station users can see station data
- Admins can see all data

## Error Codes

| Code | Description |
|------|-------------|
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Not Found |
| 406 | Not Acceptable |
| 409 | Conflict |
| 500 | Internal Server Error |

## Rate Limiting

The API has rate limits:
- **Authenticated**: 100 requests/minute
- **Anonymous**: 20 requests/minute

## Support

For API support, contact support@fuelpro.com
