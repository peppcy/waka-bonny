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
