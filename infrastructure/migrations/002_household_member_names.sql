-- Apply once after 001 with psql -X -v ON_ERROR_STOP=1.
BEGIN;
SET LOCAL lock_timeout = '10s';
-- Keep the verified empty-table precondition true until commit.
LOCK TABLE household_members, transaction_metadata, bills IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'household_members'::regclass
      AND conname = 'household_members_type_check_002'
  ) THEN
    RAISE EXCEPTION 'Migration 002 is already applied';
  END IF;
  IF (SELECT array_agg(type ORDER BY type) FROM household_members)
       IS DISTINCT FROM ARRAY['JOINT', 'ME', 'WIFE']::text[] THEN
    RAISE EXCEPTION 'Migration 002 requires exactly ME/WIFE/JOINT members';
  END IF;
  IF EXISTS (SELECT 1 FROM transaction_metadata) OR EXISTS (SELECT 1 FROM bills) THEN
    RAISE EXCEPTION 'Migration 002 requires empty transaction_metadata and bills';
  END IF;
END
$$;

SELECT type, name FROM household_members;

ALTER TABLE household_members DROP CONSTRAINT household_members_type_check;
-- UPDATE preserves UUIDs. All existing type and UUID foreign keys stay in place.
UPDATE household_members
SET type = CASE type WHEN 'ME' THEN 'MICHAEL' WHEN 'WIFE' THEN 'LIZ' ELSE 'JOINT' END,
    name = CASE type WHEN 'ME' THEN 'Michael' WHEN 'WIFE' THEN 'Liz' ELSE 'Joint household' END;
ALTER TABLE household_members ADD CONSTRAINT household_members_type_check_002
  CHECK (type IN ('MICHAEL', 'LIZ', 'JOINT'));

SELECT type, name FROM household_members;
COMMIT;
