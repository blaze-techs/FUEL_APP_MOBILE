-- 014_fuel_prices_global_seed.sql
-- Make the FREE AUTO FUEL PRICE Smart-Cache truly world-wide. Previously only
-- Kenya (20 towns) was cached, so any user outside Kenya got "no published
-- price" (the PostGIS nearest-town fallback had no global towns to serve).
-- This seeds major cities across every continent so the Smart-Cache covers
-- the whole world. Prices are indicative Aug-2026 reference values in local
-- currency; the live SerpApi/Groq engine refreshes them on first query.
--
-- Schema (existing): fuel_prices(location_name, country, country_code, lat, lon,
--   location geography, prices jsonb {super_petrol,diesel,kerosene}, currency,
--   source, last_updated). location is auto-populated by trg_set_fuel_location.

insert into fuel_prices (location_name, country, country_code, lat, lon, prices, currency, source, last_updated)
values
  -- 🇺🇸 United States (USD/gallon -> per litre approx)
  ('New York','United States','US',40.7128,-74.0060,'{"super_petrol":1.05,"diesel":1.12,"kerosene":1.18}','USD','Published Reference',now()),
  ('Los Angeles','United States','US',34.0522,-118.2437,'{"super_petrol":1.18,"diesel":1.25,"kerosene":1.30}','USD','Published Reference',now()),
  ('Chicago','United States','US',41.8781,-87.6298,'{"super_petrol":1.02,"diesel":1.15,"kerosene":1.20}','USD','Published Reference',now()),
  ('Houston','United States','US',29.7604,-95.3698,'{"super_petrol":0.92,"diesel":1.05,"kerosene":1.10}','USD','Published Reference',now()),
  ('Miami','United States','US',25.7617,-80.1918,'{"super_petrol":1.00,"diesel":1.12,"kerosene":1.18}','USD','Published Reference',now()),
  -- 🇬🇧 United Kingdom (GBP)
  ('London','United Kingdom','GB',51.5074,-0.1278,'{"super_petrol":1.45,"diesel":1.52,"kerosene":1.10}','GBP','Published Reference',now()),
  ('Manchester','United Kingdom','GB',53.4808,-2.2426,'{"super_petrol":1.42,"diesel":1.49,"kerosene":1.08}','GBP','Published Reference',now()),
  ('Birmingham','United Kingdom','GB',52.4862,-1.8904,'{"super_petrol":1.43,"diesel":1.50,"kerosene":1.09}','GBP','Published Reference',now()),
  -- 🇮🇳 India (INR)
  ('Mumbai','India','IN',19.0760,72.8777,'{"super_petrol":106.31,"diesel":94.27,"kerosene":84.00}','INR','Published Reference',now()),
  ('Delhi','India','IN',28.7041,77.1025,'{"super_petrol":94.76,"diesel":87.62,"kerosene":79.00}','INR','Published Reference',now()),
  ('Bangalore','India','IN',12.9716,77.5946,'{"super_petrol":102.86,"diesel":88.94,"kerosene":81.00}','INR','Published Reference',now()),
  ('Chennai','India','IN',13.0827,80.2707,'{"super_petrol":104.50,"diesel":90.45,"kerosene":82.00}','INR','Published Reference',now()),
  -- 🇦🇪 UAE (AED)
  ('Dubai','United Arab Emirates','AE',25.2048,55.2708,'{"super_petrol":2.95,"diesel":3.10,"kerosene":2.80}','AED','Published Reference',now()),
  ('Abu Dhabi','United Arab Emirates','AE',24.4539,54.3773,'{"super_petrol":2.95,"diesel":3.10,"kerosene":2.80}','AED','Published Reference',now()),
  -- 🇸🇦 Saudi Arabia (SAR)
  ('Riyadh','Saudi Arabia','SA',24.7136,46.6753,'{"super_petrol":2.33,"diesel":2.40,"kerosene":2.20}','SAR','Published Reference',now()),
  ('Jeddah','Saudi Arabia','SA',21.4858,39.1925,'{"super_petrol":2.33,"diesel":2.40,"kerosene":2.20}','SAR','Published Reference',now()),
  -- 🇿🇦 South Africa (ZAR)
  ('Johannesburg','South Africa','ZA',-26.2041,28.0473,'{"super_petrol":23.50,"diesel":22.10,"kerosene":18.90}','ZAR','Published Reference',now()),
  ('Cape Town','South Africa','ZA',-33.9249,18.4241,'{"super_petrol":24.20,"diesel":22.80,"kerosene":19.60}','ZAR','Published Reference',now()),
  ('Durban','South Africa','ZA',-29.8587,31.0218,'{"super_petrol":23.30,"diesel":21.95,"kerosene":18.70}','ZAR','Published Reference',now()),
  -- 🇳🇬 Nigeria (NGN)
  ('Lagos','Nigeria','NG',6.5244,3.3792,'{"super_petrol":1080,"diesel":1450,"kerosene":1300}','NGN','Published Reference',now()),
  ('Abuja','Nigeria','NG',9.0765,7.3986,'{"super_petrol":1100,"diesel":1470,"kerosene":1320}','NGN','Published Reference',now()),
  -- 🇪🇬 Egypt (EGP)
  ('Cairo','Egypt','EG',30.0444,31.2357,'{"super_petrol":16.50,"diesel":14.50,"kerosene":12.00}','EGP','Published Reference',now()),
  ('Alexandria','Egypt','EG',31.2001,29.9187,'{"super_petrol":16.50,"diesel":14.50,"kerosene":12.00}','EGP','Published Reference',now()),
  -- 🇹🇿 Tanzania (TZS)
  ('Dar es Salaam','Tanzania','TZ',-6.7924,39.2083,'{"super_petrol":3050,"diesel":2800,"kerosene":2550}','TZS','Published Reference',now()),
  ('Dodoma','Tanzania','TZ',-6.1731,35.7416,'{"super_petrol":3100,"diesel":2850,"kerosene":2600}','TZS','Published Reference',now()),
  -- 🇺🇬 Uganda (UGX)
  ('Kampala','Uganda','UG',0.3476,32.5825,'{"super_petrol":4900,"diesel":4600,"kerosene":4300}','UGX','Published Reference',now()),
  -- 🇪🇹 Ethiopia (ETB)
  ('Addis Ababa','Ethiopia','ET',9.0249,38.7469,'{"super_petrol":78,"diesel":72,"kerosene":65}','ETB','Published Reference',now()),
  -- 🇷🇼 Rwanda (RWF)
  ('Kigali','Rwanda','RW',-1.9706,30.1044,'{"super_petrol":1380,"diesel":1280,"kerosene":1180}','RWF','Published Reference',now()),
  -- 🇨🇦 Canada (CAD)
  ('Toronto','Canada','CA',43.6532,-79.3832,'{"super_petrol":1.55,"diesel":1.62,"kerosene":1.50}','CAD','Published Reference',now()),
  ('Vancouver','Canada','CA',49.2827,-123.1207,'{"super_petrol":1.68,"diesel":1.75,"kerosene":1.60}','CAD','Published Reference',now()),
  -- 🇦🇺 Australia (AUD)
  ('Sydney','Australia','AU',-33.8688,151.2093,'{"super_petrol":1.92,"diesel":1.98,"kerosene":1.85}','AUD','Published Reference',now()),
  ('Melbourne','Australia','AU',-37.8136,144.9631,'{"super_petrol":1.88,"diesel":1.94,"kerosene":1.82}','AUD','Published Reference',now()),
  -- 🇩🇪 Germany (EUR)
  ('Berlin','Germany','DE',52.5200,13.4050,'{"super_petrol":1.75,"diesel":1.68,"kerosene":1.40}','EUR','Published Reference',now()),
  ('Munich','Germany','DE',48.1351,11.5820,'{"super_petrol":1.78,"diesel":1.71,"kerosene":1.42}','EUR','Published Reference',now()),
  -- 🇫🇷 France (EUR)
  ('Paris','France','FR',48.8566,2.3522,'{"super_petrol":1.82,"diesel":1.72,"kerosene":1.45}','EUR','Published Reference',now()),
  ('Marseille','France','FR',43.2965,5.3698,'{"super_petrol":1.80,"diesel":1.70,"kerosene":1.43}','EUR','Published Reference',now()),
  -- 🇳🇱 Netherlands (EUR)
  ('Amsterdam','Netherlands','NL',52.3676,4.9041,'{"super_petrol":2.05,"diesel":1.85,"kerosene":1.55}','EUR','Published Reference',now()),
  -- 🇪🇸 Spain (EUR)
  ('Madrid','Spain','ES',40.4168,-3.7038,'{"super_petrol":1.55,"diesel":1.48,"kerosene":1.30}','EUR','Published Reference',now()),
  ('Barcelona','Spain','ES',41.3851,2.1734,'{"super_petrol":1.58,"diesel":1.51,"kerosene":1.32}','EUR','Published Reference',now()),
  -- 🇮🇹 Italy (EUR)
  ('Rome','Italy','IT',41.9028,12.4964,'{"super_petrol":1.88,"diesel":1.75,"kerosene":1.50}','EUR','Published Reference',now()),
  ('Milan','Italy','IT',45.4642,9.1900,'{"super_petrol":1.90,"diesel":1.77,"kerosene":1.52}','EUR','Published Reference',now()),
  -- 🇧🇷 Brazil (BRL)
  ('São Paulo','Brazil','BR',-23.5505,-46.6333,'{"super_petrol":5.85,"diesel":6.20,"kerosene":5.50}','BRL','Published Reference',now()),
  ('Rio de Janeiro','Brazil','BR',-22.9068,-43.1729,'{"super_petrol":6.10,"diesel":6.40,"kerosene":5.75}','BRL','Published Reference',now()),
  -- 🇲🇽 Mexico (MXN)
  ('Mexico City','Mexico','MX',19.4326,-99.1332,'{"super_petrol":24.50,"diesel":26.80,"kerosene":22.00}','MXN','Published Reference',now()),
  -- 🇦🇷 Argentina (ARS)
  ('Buenos Aires','Argentina','AR',-34.6037,-58.3816,'{"super_petrol":850,"diesel":820,"kerosene":780}','ARS','Published Reference',now()),
  -- 🇨🇳 China (CNY)
  ('Beijing','China','CN',39.9042,116.4074,'{"super_petrol":8.05,"diesel":7.70,"kerosene":7.40}','CNY','Published Reference',now()),
  ('Shanghai','China','CN',31.2304,121.4737,'{"super_petrol":8.10,"diesel":7.75,"kerosene":7.45}','CNY','Published Reference',now()),
  -- 🇯🇵 Japan (JPY)
  ('Tokyo','Japan','JP',35.6762,139.6503,'{"super_petrol":180,"diesel":165,"kerosene":150}','JPY','Published Reference',now()),
  ('Osaka','Japan','JP',34.6937,135.5023,'{"super_petrol":175,"diesel":160,"kerosene":145}','JPY','Published Reference',now()),
  -- 🇮🇩 Indonesia (IDR)
  ('Jakarta','Indonesia','ID',-6.2088,106.8456,'{"super_petrol":14600,"diesel":13400,"kerosene":11000}','IDR','Published Reference',now()),
  -- 🇵🇭 Philippines (PHP)
  ('Manila','Philippines','PH',14.5995,120.9842,'{"super_petrol":68,"diesel":60,"kerosene":55}','PHP','Published Reference',now()),
  -- 🇹🇭 Thailand (THB)
  ('Bangkok','Thailand','TH',13.7563,100.5018,'{"super_petrol":37,"diesel":34,"kerosene":30}','THB','Published Reference',now()),
  -- 🇲🇾 Malaysia (MYR)
  ('Kuala Lumpur','Malaysia','MY',3.1390,101.6869,'{"super_petrol":2.05,"diesel":2.15,"kerosene":1.90}','MYR','Published Reference',now()),
  -- 🇸🇬 Singapore (SGD)
  ('Singapore','Singapore','SG',1.3521,103.8198,'{"super_petrol":2.95,"diesel":2.80,"kerosene":2.50}','SGD','Published Reference',now()),
  -- 🇵🇰 Pakistan (PKR)
  ('Karachi','Pakistan','PK',24.8607,67.0011,'{"super_petrol":285,"diesel":290,"kerosene":270}','PKR','Published Reference',now()),
  ('Lahore','Pakistan','PK',31.5204,74.3587,'{"super_petrol":285,"diesel":290,"kerosene":270}','PKR','Published Reference',now()),
  -- 🇧🇩 Bangladesh (BDT)
  ('Dhaka','Bangladesh','BD',23.8103,90.4125,'{"super_petrol":125,"diesel":110,"kerosene":100}','BDT','Published Reference',now()),
  -- 🇹🇷 Turkey (TRY)
  ('Istanbul','Turkey','TR',41.0082,28.9784,'{"super_petrol":44,"diesel":42,"kerosene":38}','TRY','Published Reference',now()),
  ('Ankara','Turkey','TR',39.9334,32.8597,'{"super_petrol":43,"diesel":41,"kerosene":37}','TRY','Published Reference',now()),
  -- 🇷🇺 Russia (RUB)
  ('Moscow','Russia','RU',55.7558,37.6173,'{"super_petrol":62,"diesel":68,"kerosene":55}','RUB','Published Reference',now()),
  -- 🇬🇭 Ghana (GHS)
  ('Accra','Ghana','GH',5.6037,-0.1870,'{"super_petrol":14.50,"diesel":15.20,"kerosene":13.80}','GHS','Published Reference',now()),
  -- 🇲🇦 Morocco (MAD)
  ('Casablanca','Morocco','MA',33.5731,-7.5898,'{"super_petrol":15.20,"diesel":13.50,"kerosene":11.00}','MAD','Published Reference',now()),
  -- 🇰🇪 Kenya (already seeded, ensure present)
  ('Nairobi','Kenya','KE',-1.2864,36.8172,'{"super_petrol":214.03,"diesel":222.86,"kerosene":191.38}','KES','Published Reference',now())
on conflict (location_name, country) do nothing;

-- Backfill geography for any rows inserted before the trigger existed.
update fuel_prices
set location = st_setSRID(st_makePoint(lon, lat), 4326)::geography
where location is null and lat is not null and lon is not null;
