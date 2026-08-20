ALTER TABLE control.sdk_keys
  ADD COLUMN platform text
  CHECK (platform IS NULL OR platform IN ('android', 'ios'));

COMMENT ON COLUMN control.sdk_keys.platform IS
  'Issuing SDK platform. NULL preserves pre-M4 key rows; new issuance must set android or ios.';
