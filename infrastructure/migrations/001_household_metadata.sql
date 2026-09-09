-- Apply once with psql -v ON_ERROR_STOP=1. A transaction prevents partial installs.
BEGIN;
CREATE TABLE household_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (btrim(name) <> ''),
  type text NOT NULL UNIQUE CHECK (type IN ('ME', 'WIFE', 'JOINT'))
);
CREATE TABLE split_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (btrim(name) <> ''),
  me_percentage numeric(5,2) NOT NULL CHECK (me_percentage BETWEEN 0 AND 100),
  wife_percentage numeric(5,2) NOT NULL CHECK (wife_percentage BETWEEN 0 AND 100),
  CHECK (me_percentage + wife_percentage = 100)
);
CREATE TABLE transaction_metadata (
  actual_transaction_id text PRIMARY KEY CHECK (actual_transaction_id <> ''),
  expense_owner text REFERENCES household_members(type),
  payer text REFERENCES household_members(type),
  split_rule uuid REFERENCES split_rules(id),
  notes text,
  review_status text NOT NULL DEFAULT 'NEEDS_REVIEW'
    CHECK (review_status IN ('NEEDS_REVIEW', 'REVIEWED'))
);
CREATE TABLE bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (btrim(name) <> ''),
  actual_schedule_id text NOT NULL UNIQUE CHECK (actual_schedule_id <> ''),
  -- Optional display snapshots of Actual schedule fields, never recurrence inputs.
  category text,
  expected_amount bigint,
  frequency jsonb,
  due_date date,
  expense_owner text REFERENCES household_members(type),
  responsible_person uuid REFERENCES household_members(id),
  payer text REFERENCES household_members(type),
  payment_account_id text,
  autopay boolean NOT NULL DEFAULT false,
  split_rule uuid REFERENCES split_rules(id),
  active boolean NOT NULL DEFAULT true,
  notes text
);
COMMENT ON COLUMN bills.expected_amount IS 'Optional schedule display snapshot in Actual integer minor units; not a payment or balance.';
COMMENT ON COLUMN bills.frequency IS 'Optional Actual recurrence JSON snapshot; evaluate recurrence only in Actual.';
CREATE TABLE household_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  default_joint_split uuid REFERENCES split_rules(id),
  currency text NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  timezone text NOT NULL DEFAULT 'Etc/UTC',
  budget_month_start smallint NOT NULL DEFAULT 1 CHECK (budget_month_start BETWEEN 1 AND 28),
  notification_preferences jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(notification_preferences) = 'object')
);
INSERT INTO household_members(name, type) VALUES ('Me', 'ME'), ('Wife', 'WIFE'), ('Joint household', 'JOINT');
INSERT INTO split_rules(name, me_percentage, wife_percentage) VALUES ('50/50', 50, 50);
INSERT INTO household_settings(default_joint_split) SELECT id FROM split_rules WHERE name = '50/50';
COMMIT;
