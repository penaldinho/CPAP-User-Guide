CREATE TABLE IF NOT EXISTS chat_eval_rubric (
  id BIGSERIAL PRIMARY KEY,
  family TEXT NOT NULL DEFAULT 'cpap',
  guide_key TEXT NOT NULL,
  case_id INTEGER NOT NULL,
  case_label TEXT NOT NULL,
  expected_outcome TEXT NOT NULL,
  expected_answer_summary TEXT,
  expected_response_canonical TEXT,
  must_contain_any JSONB NOT NULL DEFAULT '[]'::jsonb,
  must_contain_all JSONB NOT NULL DEFAULT '[]'::jsonb,
  must_not_contain_any JSONB NOT NULL DEFAULT '[]'::jsonb,
  allowed_section_titles JSONB NOT NULL DEFAULT '[]'::jsonb,
  image_expectation TEXT NOT NULL DEFAULT 'optional',
  expected_image_page_title TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chat_eval_rubric_expected_outcome_check CHECK (expected_outcome IN ('answer', 'partial_answer', 'no_direct_info', 'scope_fallback')),
  CONSTRAINT chat_eval_rubric_image_expectation_check CHECK (image_expectation IN ('required', 'forbidden', 'optional')),
  CONSTRAINT chat_eval_rubric_family_guide_case_unique UNIQUE (family, guide_key, case_id)
);

ALTER TABLE chat_eval_rubric
  ADD COLUMN IF NOT EXISTS expected_response_canonical TEXT;

ALTER TABLE chat_eval_rubric
  DROP CONSTRAINT IF EXISTS chat_eval_rubric_expected_outcome_check;

ALTER TABLE chat_eval_rubric
  ADD CONSTRAINT chat_eval_rubric_expected_outcome_check
  CHECK (expected_outcome IN ('answer', 'partial_answer', 'no_direct_info', 'scope_fallback'));

CREATE INDEX IF NOT EXISTS idx_chat_eval_rubric_lookup
  ON chat_eval_rubric (family, guide_key, case_id);

INSERT INTO chat_eval_rubric (
  family,
  guide_key,
  case_id,
  case_label,
  expected_outcome,
  expected_answer_summary,
  expected_response_canonical,
  must_contain_any,
  must_contain_all,
  must_not_contain_any,
  allowed_section_titles,
  image_expectation,
  expected_image_page_title,
  notes
)
VALUES
  (
    'cpap', 'airsense-10', 1, 'Setup before fitting', 'answer',
    'Provide the AirSense 10 setup steps needed to prepare the device for first use and connect the mask, without moving into mask fitting.',
    'Set up the AirSense 10 by placing the device on a stable, level surface, connecting the power supply, connecting the air tubing to the rear air outlet, opening the humidifier and filling it to the maximum water level mark, closing and inserting the humidifier, and connecting the free end of the tubing to the assembled mask. This is supported by the "Setup" section.',
    '["Setup", "connect the mask", "device is ready"]'::jsonb,
    '[]'::jsonb,
    '["Run Mask Fit", "Mask Fit"]'::jsonb,
    '["Setup"]'::jsonb,
    'optional',
    'Setup',
    'Should stay within setup and stop before fitting the mask.'
  ),
  (
    'cpap', 'airsense-10', 2, 'Routine use and mask fit', 'answer',
    'Explain mask fitting at a high level, using Check Mask Fit / Run Mask Fit on the AirSense 10, then starting therapy.',
    'Fit the mask as described in the mask user guide. In My Options, turn the dial to highlight Run Mask Fit and press the dial, then adjust the mask, mask cushion, and headgear until you get a Good result. To start therapy, press Start/Stop or breathe normally if SmartStart is enabled. This is supported by the "Mask Fit" part of "My Options" and by "Starting Therapy".',
    '["Mask Fit", "My Options", "Starting Therapy"]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '["My Options", "Starting Therapy"]'::jsonb,
    'optional',
    'My Options',
    'Should mention Check Mask Fit / Run Mask Fit and starting therapy.'
  ),
  (
    'cpap', 'airsense-10', 3, 'Dry nose troubleshooting', 'answer',
    'Advise increasing Humidity Level for a dry nose or mouth, with support from Troubleshooting and/or My Options.',
    'Adjust the Humidity Level. If you are getting a dry nose or mouth, increase the humidity level. In My Options, turn the dial to highlight Humidity Level, press the dial, adjust the humidity level, and press the dial to save the change. If you have ClimateLineAir heated air tubing, the guide also says to see the ClimateLineAir user guide. This is supported by "Troubleshooting" and "Humidity Level" in "My Options".',
    '["Humidity Level", "dry nose", "dry mouth"]'::jsonb,
    '[]'::jsonb,
    '["manual does not provide specific information"]'::jsonb,
    '["Troubleshooting", "My Options", "Humidity Level", "To adjust Humidity Level"]'::jsonb,
    'optional',
    'My Options',
    'ClimateLineAir may be mentioned only as a grounded secondary note.'
  ),
  (
    'cpap', 'airsense-10', 4, 'AirSense cleaning frequency', 'answer',
    'State that the AirSense 10 device itself should be cleaned weekly.',
    'The AirSense 10 device itself should be cleaned weekly. The guide says to wipe the exterior of the device with a dry cloth. This is supported by the "Cleaning" section in "Caring for Your Device".',
    '["weekly", "once a week", "every week"]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '["Caring for your device"]'::jsonb,
    'forbidden',
    NULL,
    'Answer should be a direct maintenance frequency response.'
  ),
  (
    'cpap', 'airsense-10', 5, 'AirSense error 006', 'answer',
    'State the immediate action for Error 006 from the troubleshooting guidance, typically contacting the care provider and not opening the device.',
    'For System fault, refer to user guide, Error 006, the immediate action is to contact your care provider and not open the device. This is supported by "All other error messages (e.g. System fault, Error 0XX)" in "Troubleshooting".',
    '["Error 006", "care provider", "do not open"]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '["Troubleshooting"]'::jsonb,
    'forbidden',
    NULL,
    'Safety-critical answer should be explicit and concise.'
  ),
  (
    'cpap', 'airsense-10', 6, 'Vitera storage temperature', 'scope_fallback',
    'This question is about the F&P Vitera guide, so AirSense should not answer it.',
    'Your question mentions F&P Vitera Full Face Mask, but this chat is currently scoped to AirSense 10. I can only answer from the selected guide. Please switch guides or ask an AirSense 10 question.',
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    'forbidden',
    NULL,
    'Correct behavior is a scope fallback because the question explicitly names Vitera.'
  ),
  (
    'cpap', 'airsense-10', 7, 'ClimateLineAir tubing sufficiency', 'scope_fallback',
    'This question is about ClimateLineAir tubing length, so AirSense should not answer it as an AirSense-only guide question.',
    'Your question mentions ResMed ClimateLineAir, but this chat is currently scoped to AirSense 10. I can only answer from the selected guide. Please switch guides or ask an AirSense 10 question.',
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    'forbidden',
    NULL,
    'Correct behavior is a scope fallback because the question explicitly names ClimateLineAir.'
  ),

  (
    'cpap', 'fp-vitera', 1, 'Setup before fitting', 'no_direct_info',
    'The Vitera guide is a mask guide and does not provide CPAP device and tubing setup instructions for first use.',
    'The F&P Vitera Full Face mask guide does not provide instructions for setting up the CPAP device and tubing for first use. It only provides mask fitting, cleaning, assembly, operating instructions, technical information, warranty, and further information for the mask.',
    '["does not provide", "specific information", "device"]'::jsonb,
    '[]'::jsonb,
    '["AirSense 10 setup instructions"]'::jsonb,
    '[]'::jsonb,
    'forbidden',
    NULL,
    'Vitera should not invent CPAP device setup steps.'
  ),
  (
    'cpap', 'fp-vitera', 2, 'Routine use and mask fit', 'partial_answer',
    'Provide the Vitera mask fitting steps, but explicitly note that the guide does not include CPAP-device-specific Check Mask Fit or therapy-start instructions.',
    'Fit the mask by holding the front of the mask with one hand and the headgear with the other, ensuring one headgear clip is unhooked from the frame; place the seal onto the face and guide the headgear over the head; hook the unattached headgear clip onto the frame; and gently tighten the headgear straps, starting with the bottom straps and then the blue forehead straps. The Vitera guide does not provide the CPAP device Check Mask Fit option or starting-therapy instructions.',
    '["fit", "headgear", "seal", "frame"]'::jsonb,
    '[]'::jsonb,
    '["Run Mask Fit", "AirSense 10"]'::jsonb,
    '["Fitting Your Mask"]'::jsonb,
    'optional',
    'Fitting Your Mask',
    'A strict guide-bounded answer should focus on fitting the mask rather than CPAP-device-specific Mask Fit UI.'
  ),
  (
    'cpap', 'fp-vitera', 3, 'Dry nose troubleshooting', 'no_direct_info',
    'The Vitera guide does not provide comfort-setting instructions for dry nose during therapy.',
    'The F&P Vitera Full Face mask guide does not provide comfort-setting instructions for resolving a dry nose during therapy.',
    '["does not provide", "specific information"]'::jsonb,
    '[]'::jsonb,
    '["Humidity Level", "Climate Control"]'::jsonb,
    '[]'::jsonb,
    'forbidden',
    NULL,
    'Should not attach a technical flow image.'
  ),
  (
    'cpap', 'fp-vitera', 4, 'AirSense cleaning frequency', 'scope_fallback',
    'This question is about the AirSense 10 device, not the Vitera mask guide.',
    'Your question mentions AirSense 10, but this chat is currently scoped to F&P Vitera Full Face Mask. I can only answer from the selected guide. Please switch guides or ask an F&P Vitera Full Face Mask question.',
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    'forbidden',
    NULL,
    'Correct behavior is a scope fallback.'
  ),
  (
    'cpap', 'fp-vitera', 5, 'AirSense error 006', 'scope_fallback',
    'This question is about an AirSense device error, not the Vitera guide.',
    'Your question mentions AirSense 10, but this chat is currently scoped to F&P Vitera Full Face Mask. I can only answer from the selected guide. Please switch guides or ask an F&P Vitera Full Face Mask question.',
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    'forbidden',
    NULL,
    'Correct behavior is a scope fallback.'
  ),
  (
    'cpap', 'fp-vitera', 6, 'Vitera storage temperature', 'answer',
    'State the Vitera storage temperature range of -20 to 50°C (-4 to 122°F).',
    'Store the dry mask in clean conditions out of direct sunlight. The recommended storage temperature is -20 to 50°C (-4 to 122°F). This is supported by the "Storage" section in "Technical Information".',
    '["-20 to 50", "-4 to 122", "storage temperature"]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '["Technical Information", "Storage"]'::jsonb,
    'forbidden',
    NULL,
    'May answer in Celsius, Fahrenheit, or both, provided the range is correct.'
  ),
  (
    'cpap', 'fp-vitera', 7, 'ClimateLineAir tubing sufficiency', 'scope_fallback',
    'This question is about ClimateLineAir tubing length, not the Vitera guide.',
    'Your question mentions ResMed ClimateLineAir, but this chat is currently scoped to F&P Vitera Full Face Mask. I can only answer from the selected guide. Please switch guides or ask an F&P Vitera Full Face Mask question.',
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    'forbidden',
    NULL,
    'Correct behavior is a scope fallback.'
  ),

  (
    'cpap', 'climatelineair', 1, 'Setup before fitting', 'answer',
    'Provide ClimateLineAir setup instructions: connect the tubing to the device and connect the assembled mask, without moving into mask fitting.',
    'Set up the ClimateLineAir by making sure the device is connected and turned on, holding the cuff of the air tubing and lining up the connector with the connector port, pushing the cuff until the connector clicks into place, and connecting the assembled mask to the free end of the air tubing. This is supported by the "Setup" section.',
    '["connector clicks into place", "Connect the assembled mask", "Setup"]'::jsonb,
    '[]'::jsonb,
    '["Mask Fit"]'::jsonb,
    '["Setup"]'::jsonb,
    'optional',
    'Setup',
    'Should remain within ClimateLineAir setup.'
  ),
  (
    'cpap', 'climatelineair', 2, 'Routine use and mask fit', 'no_direct_info',
    'The ClimateLineAir guide does not provide mask fitting or CPAP device Mask Fit workflow instructions.',
    'The ClimateLineAir guide does not provide mask fitting instructions or CPAP device Check Mask Fit and starting-therapy instructions.',
    '["does not provide", "specific information"]'::jsonb,
    '[]'::jsonb,
    '["Run Mask Fit", "Fitting Your Mask"]'::jsonb,
    '[]'::jsonb,
    'forbidden',
    NULL,
    'ClimateLineAir should not answer this as a full routine-use workflow.'
  ),
  (
    'cpap', 'climatelineair', 3, 'Dry nose troubleshooting', 'answer',
    'Explain that Climate Control helps prevent dryness of the nose and mouth, and refer to temperature / humidity settings as supported by the guide.',
    'Climate Control is designed to prevent dryness of the nose and mouth. If you are getting a dry nose or mouth, turn up the humidity. In My Options, turn the dial to highlight Humidity Level, press the dial, turn the dial to adjust the humidity level, and press the dial to save the change. This is supported by "Climate Control" and "Humidity Level".',
    '["dryness of the nose and mouth", "Climate Control", "temperature", "humidity"]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '["Climate Control", "Climate Control Auto", "Climate Control Manual"]'::jsonb,
    'optional',
    'Climate Control',
    'Answer should be grounded in Climate Control guidance rather than AirSense My Options.'
  ),
  (
    'cpap', 'climatelineair', 4, 'AirSense cleaning frequency', 'scope_fallback',
    'This question is about AirSense device cleaning frequency, not the ClimateLineAir guide.',
    'Your question mentions AirSense 10, but this chat is currently scoped to ResMed ClimateLineAir. I can only answer from the selected guide. Please switch guides or ask a ResMed ClimateLineAir question.',
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    'forbidden',
    NULL,
    'Correct behavior is a scope fallback.'
  ),
  (
    'cpap', 'climatelineair', 5, 'AirSense error 006', 'scope_fallback',
    'This question is about an AirSense device error, not the ClimateLineAir guide.',
    'Your question mentions AirSense 10, but this chat is currently scoped to ResMed ClimateLineAir. I can only answer from the selected guide. Please switch guides or ask a ResMed ClimateLineAir question.',
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    'forbidden',
    NULL,
    'Correct behavior is a scope fallback.'
  ),
  (
    'cpap', 'climatelineair', 6, 'Vitera storage temperature', 'scope_fallback',
    'This question is about the F&P Vitera guide, not the ClimateLineAir guide.',
    'Your question mentions F&P Vitera Full Face Mask, but this chat is currently scoped to ResMed ClimateLineAir. I can only answer from the selected guide. Please switch guides or ask a ResMed ClimateLineAir question.',
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    'forbidden',
    NULL,
    'Correct behavior is a scope fallback.'
  ),
  (
    'cpap', 'climatelineair', 7, 'ClimateLineAir tubing sufficiency', 'answer',
    'State that ClimateLineAir length is 6 ft 6 in (2 m), so 7 ft is insufficient by 6 inches.',
    'ClimateLineAir tubing length is 6 ft 6 in (2 m), so it is not sufficient for a 7 ft distance. It falls short by 6 in. This is supported by the "Length" part of "Technical Specifications".',
    '["6 ft 6 in", "2 m", "insufficient", "7 ft"]'::jsonb,
    '[]'::jsonb,
    '["does not specify the tubing length"]'::jsonb,
    '["Technical Specifications", "Length"]'::jsonb,
    'forbidden',
    NULL,
    'A high-quality answer should compare the two values and quantify the shortfall.'
  )
ON CONFLICT (family, guide_key, case_id)
DO UPDATE SET
  case_label = EXCLUDED.case_label,
  expected_outcome = EXCLUDED.expected_outcome,
  expected_answer_summary = EXCLUDED.expected_answer_summary,
  expected_response_canonical = EXCLUDED.expected_response_canonical,
  must_contain_any = EXCLUDED.must_contain_any,
  must_contain_all = EXCLUDED.must_contain_all,
  must_not_contain_any = EXCLUDED.must_not_contain_any,
  allowed_section_titles = EXCLUDED.allowed_section_titles,
  image_expectation = EXCLUDED.image_expectation,
  expected_image_page_title = EXCLUDED.expected_image_page_title,
  notes = EXCLUDED.notes,
  updated_at = NOW();

CREATE OR REPLACE VIEW chat_eval_results_with_rubric AS
SELECT
  r.id,
  r.run_id,
  r.evaluated_at,
  r.guide_key,
  r.guide_name,
  r.case_id,
  r.case_label,
  r.category,
  r.question,
  r.duration_ms,
  r.response,
  r.error_text,
  r.has_scope_fallback,
  r.has_no_direct_instruction_fallback,
  r.image_attached,
  r.image_page_title,
  r.image_alt,
  r.cited_sections,
  r.invalid_citations,
  r.mentions_other_guides,
  rb.expected_outcome,
  rb.expected_answer_summary,
  rb.expected_response_canonical,
  rb.must_contain_any,
  rb.must_contain_all,
  rb.must_not_contain_any,
  rb.allowed_section_titles,
  rb.image_expectation,
  rb.expected_image_page_title,
  rb.notes,
  CASE
    WHEN rb.expected_outcome = 'scope_fallback' THEN r.has_scope_fallback
    WHEN rb.expected_outcome = 'no_direct_info' THEN r.has_no_direct_instruction_fallback
    WHEN rb.expected_outcome = 'answer' THEN NOT r.has_scope_fallback AND NOT r.has_no_direct_instruction_fallback AND COALESCE(r.error_text, '') = ''
    WHEN rb.expected_outcome = 'partial_answer' THEN NULL
    ELSE NULL
  END AS outcome_matches,
  CASE
    WHEN rb.image_expectation = 'required' THEN r.image_attached
    WHEN rb.image_expectation = 'forbidden' THEN NOT r.image_attached
    WHEN rb.image_expectation = 'optional' THEN TRUE
    ELSE NULL
  END AS image_expectation_matches,
  CASE
    WHEN COALESCE(JSONB_ARRAY_LENGTH(r.invalid_citations), 0) = 0 THEN TRUE
    ELSE FALSE
  END AS citation_valid
FROM chat_eval_results r
LEFT JOIN chat_eval_rubric rb
  ON rb.family = 'cpap'
  AND rb.guide_key = r.guide_key
  AND rb.case_id = r.case_id;
