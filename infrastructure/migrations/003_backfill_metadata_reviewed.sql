-- Rerunnable after 001 and 002. Apply with psql -X -v ON_ERROR_STOP=1.
BEGIN;
SET LOCAL lock_timeout = '10s';
-- Keep the precondition and settings stable through the update.
LOCK TABLE transaction_metadata, household_settings IN SHARE ROW EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM transaction_metadata
    WHERE review_status = 'NEEDS_REVIEW' AND expense_owner = 'JOINT' AND split_rule IS NULL
  ) AND NOT EXISTS (
    SELECT 1 FROM household_settings WHERE id = true AND default_joint_split IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Backfill requires a household default joint split';
  END IF;
END
$$;
UPDATE transaction_metadata
SET review_status = 'REVIEWED',
    payer = COALESCE(payer, expense_owner),
    split_rule = CASE
      WHEN expense_owner = 'JOINT' AND split_rule IS NULL
        THEN (SELECT default_joint_split FROM household_settings WHERE id = true)
      ELSE split_rule
    END
WHERE review_status = 'NEEDS_REVIEW';
COMMIT;
