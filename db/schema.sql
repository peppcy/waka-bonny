CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT UNIQUE NOT NULL,
  pin_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'passenger' CHECK (role IN ('passenger','driver','admin')),
  emergency_phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS zones (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  sort INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true
);

-- zone_a <= zone_b always; amount NULL = placeholder, not yet set
CREATE TABLE IF NOT EXISTS fares (
  zone_a INT NOT NULL REFERENCES zones(id),
  zone_b INT NOT NULL REFERENCES zones(id),
  vehicle_type TEXT NOT NULL CHECK (vehicle_type IN ('keke','okada','taxi')),
  amount INT,
  PRIMARY KEY (zone_a, zone_b, vehicle_type)
);

CREATE TABLE IF NOT EXISTS drivers (
  user_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  vehicle_type TEXT NOT NULL CHECK (vehicle_type IN ('keke','okada','taxi','bus','sienna')),
  plate TEXT NOT NULL,
  permit_no TEXT NOT NULL,
  vehicle_desc TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','suspended')),
  strikes INT NOT NULL DEFAULT 0,
  online BOOLEAN NOT NULL DEFAULT false,
  zone_id INT REFERENCES zones(id),
  badge_code TEXT UNIQUE NOT NULL,
  last_seen TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS rides (
  id SERIAL PRIMARY KEY,
  token TEXT UNIQUE NOT NULL,
  passenger_id INT NOT NULL REFERENCES users(id),
  driver_id INT REFERENCES users(id),
  vehicle_type TEXT NOT NULL,
  from_zone INT NOT NULL REFERENCES zones(id),
  to_zone INT NOT NULL REFERENCES zones(id),
  pickup_note TEXT,
  dropoff_note TEXT,
  fare INT NOT NULL,
  night BOOLEAN NOT NULL DEFAULT false,
  street_hail BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','accepted','arrived','started','completed','cancelled')),
  cancelled_by TEXT,
  pay_method TEXT,
  rating INT CHECK (rating BETWEEN 1 AND 5),
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS rides_status_idx ON rides(status, vehicle_type);

CREATE TABLE IF NOT EXISTS sos_alerts (
  id SERIAL PRIMARY KEY,
  ride_id INT REFERENCES rides(id),
  booking_id INT,
  user_id INT NOT NULL REFERENCES users(id),
  note TEXT,
  resolved BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS complaints (
  id SERIAL PRIMARY KEY,
  ride_id INT REFERENCES rides(id),
  driver_id INT REFERENCES users(id),
  passenger_id INT NOT NULL REFERENCES users(id),
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','strike','dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS intercity_routes (
  id SERIAL PRIMARY KEY,
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  stops TEXT NOT NULL DEFAULT '',
  price_bus INT,
  price_sienna INT,
  active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (origin, destination)
);

CREATE TABLE IF NOT EXISTS departures (
  id SERIAL PRIMARY KEY,
  route_id INT NOT NULL REFERENCES intercity_routes(id),
  driver_id INT NOT NULL REFERENCES users(id),
  vehicle_type TEXT NOT NULL CHECK (vehicle_type IN ('bus','sienna')),
  seats_total INT NOT NULL CHECK (seats_total > 0),
  depart_at TIMESTAMPTZ NOT NULL,
  price INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled','boarding','departed','arrived','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bookings (
  id SERIAL PRIMARY KEY,
  ref TEXT UNIQUE NOT NULL,
  departure_id INT NOT NULL REFERENCES departures(id),
  passenger_id INT NOT NULL REFERENCES users(id),
  seats INT NOT NULL CHECK (seats BETWEEN 1 AND 6),
  passenger_name TEXT NOT NULL,
  passenger_phone TEXT NOT NULL,
  nok_name TEXT NOT NULL,
  nok_phone TEXT NOT NULL,
  drop_stop TEXT,
  status TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','boarded','cancelled','no_show')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Live GPS tracking
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS heading REAL;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS loc_at TIMESTAMPTZ;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS pickup_lat DOUBLE PRECISION;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS pickup_lng DOUBLE PRECISION;
CREATE TABLE IF NOT EXISTS ride_points (
  id BIGSERIAL PRIMARY KEY,
  ride_id INT NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ride_points_ride_idx ON ride_points(ride_id, id);
-- Passenger phone is the primary GPS source once the trip starts
ALTER TABLE rides ADD COLUMN IF NOT EXISTS pax_lat DOUBLE PRECISION;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS pax_lng DOUBLE PRECISION;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS pax_loc_at TIMESTAMPTZ;

-- ===== SMS OTP =====
CREATE TABLE IF NOT EXISTS otps (
  id SERIAL PRIMARY KEY,
  phone TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('register','reset')),
  code_hash TEXT NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  used BOOLEAN NOT NULL DEFAULT false,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS otps_phone_idx ON otps(phone, purpose, id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT false;

-- ===== Deliveries (parcel / errand) share the rides table =====
ALTER TABLE rides ADD COLUMN IF NOT EXISTS service TEXT NOT NULL DEFAULT 'ride';
ALTER TABLE rides DROP CONSTRAINT IF EXISTS rides_service_check;
ALTER TABLE rides ADD CONSTRAINT rides_service_check CHECK (service IN ('ride','parcel','errand'));
ALTER TABLE rides ADD COLUMN IF NOT EXISTS item_desc TEXT;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS recipient_name TEXT;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS recipient_phone TEXT;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS item_cost INT;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS delivery_code TEXT;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS payout_at TIMESTAMPTZ;

-- ===== Payments (Paystack) =====
CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  ref TEXT UNIQUE NOT NULL,
  user_id INT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('ride','seat','sub_auto','sub_week')),
  ride_id INT REFERENCES rides(id),
  booking_id INT REFERENCES bookings(id),
  amount INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','success','failed')),
  channel TEXT,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payments_user_idx ON payments(user_id, id);

-- Intercity: seats held while paying online
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS paid BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS hold_until TIMESTAMPTZ;
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_status_check CHECK (status IN ('held','booked','boarded','cancelled','no_show'));

-- Weekly driver subscriptions
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS sub_paid_until TIMESTAMPTZ;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS sub_code TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS sub_email_token TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS sub_auto BOOLEAN NOT NULL DEFAULT false;

-- ===== Platform owner: ban / delete users =====
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_reason TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS blocked_phones (
  phone_hash TEXT PRIMARY KEY,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS admin_actions (
  id SERIAL PRIMARY KEY,
  admin_id INT NOT NULL REFERENCES users(id),
  user_id INT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===== Driver bank account (customers pay by transfer; admin payouts) =====
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS bank_code TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS bank_name TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS account_number TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS account_name TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS account_verified BOOLEAN NOT NULL DEFAULT false;
-- Vehicle ownership (driver owns it, or drives for an owner)
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS owner_type TEXT NOT NULL DEFAULT 'self';
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS owner_name TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS owner_phone TEXT;

-- ===== Depots, packages and delivery runs =====
CREATE TABLE IF NOT EXISTS depots (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  zone_id INT REFERENCES zones(id),
  address TEXT,
  phone TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS depot_id INT REFERENCES depots(id);
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('passenger','driver','admin','agent'));

CREATE TABLE IF NOT EXISTS runs (
  id SERIAL PRIMARY KEY,
  depot_id INT NOT NULL REFERENCES depots(id),
  driver_id INT REFERENCES users(id),
  vehicle_type TEXT NOT NULL CHECK (vehicle_type IN ('keke','okada','taxi')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','picked_up','done','cancelled')),
  fee_total INT NOT NULL DEFAULT 0,
  cash_due INT NOT NULL DEFAULT 0,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ, picked_at TIMESTAMPTZ, done_at TIMESTAMPTZ,
  returns_received_at TIMESTAMPTZ,
  remitted_at TIMESTAMPTZ, remitted_by INT REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS runs_status_idx ON runs(status, vehicle_type);

CREATE TABLE IF NOT EXISTS packages (
  id SERIAL PRIMARY KEY,
  ref TEXT UNIQUE NOT NULL,
  token TEXT UNIQUE NOT NULL,
  depot_id INT NOT NULL REFERENCES depots(id),
  recipient_name TEXT NOT NULL,
  recipient_phone TEXT NOT NULL,
  description TEXT,
  qty INT NOT NULL DEFAULT 1,
  charge INT NOT NULL DEFAULT 0,
  delivery_fee INT,
  zone_id INT REFERENCES zones(id),
  address TEXT,
  drop_lat DOUBLE PRECISION, drop_lng DOUBLE PRECISION,
  code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'at_depot'
    CHECK (status IN ('at_depot','delivery_requested','assigned','out_for_delivery','delivered','collected','returned')),
  run_id INT REFERENCES runs(id),
  pay_method TEXT,
  collected_amount INT,
  fail_reason TEXT,
  handed_at TIMESTAMPTZ,
  handover_note TEXT,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS packages_depot_idx ON packages(depot_id, status);
CREATE INDEX IF NOT EXISTS packages_phone_idx ON packages(recipient_phone);
CREATE INDEX IF NOT EXISTS packages_run_idx ON packages(run_id);
