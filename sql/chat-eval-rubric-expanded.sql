-- ============================================================
-- Expanded chat evaluation rubric rows (cases 8–40)
-- AirSense 10 guide only — extends the existing 21-row rubric
-- Run AFTER the original chat-eval-rubric.sql
-- ============================================================

INSERT INTO chat_eval_rubric (
  family, guide_key, case_id, case_label,
  expected_outcome,
  expected_answer_summary,
  expected_response_canonical,
  must_contain_any, must_contain_all, must_not_contain_any,
  allowed_section_titles,
  image_expectation, expected_image_page_title, notes
)
VALUES

-- -------------------------------------------------------
-- DIRECT FACTUAL (cases 8–15)
-- -------------------------------------------------------

(
  'cpap', 'airsense-10', 8, 'Operating pressure range', 'answer',
  'State the operating pressure range of 4 to 20 cm H2O.',
  'The AirSense 10 operating pressure range is 4 to 20 cm H₂O (4 to 20 hPa). This is supported by "Technical Specifications".',
  '["4 to 20", "4–20", "cm H2O", "cmH2O", "cm H₂O"]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  '["Technical Specifications"]'::jsonb,
  'forbidden', NULL,
  'Straightforward spec lookup.'
),

(
  'cpap', 'airsense-10', 9, 'Device weight', 'answer',
  'State the device weight of 1248 g including the cleanable humidifier.',
  'The AirSense 10 weighs 1248 g (approximately 1.25 kg) including the cleanable humidifier. This is from "Technical Specifications".',
  '["1248", "1.248 kg", "1.25 kg"]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  '["Technical Specifications"]'::jsonb,
  'forbidden', NULL,
  'Must cite the correct weight value.'
),

(
  'cpap', 'airsense-10', 10, 'Device noise level', 'answer',
  'State the sound level of 25–27 dBA depending on tubing type.',
  'The AirSense 10 sound pressure level is 25 dBA ± 2 dBA with SlimLine tubing, or 27 dBA ± 2 dBA with humidification. This is from "Technical Specifications".',
  '["25 dBA", "27 dBA", "dBA"]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  '["Technical Specifications"]'::jsonb,
  'forbidden', NULL,
  'Should cite sound pressure or power levels from specs.'
),

(
  'cpap', 'airsense-10', 11, 'Device warranty period', 'answer',
  'State the 2-year warranty period for the CPAP device.',
  'The AirSense 10 device has a 2-year warranty. The humidifier has a 1-year warranty, and mask accessories have a 90-day warranty. This is from "Limited Warranty".',
  '["2 year", "two year", "24 month"]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  '["Limited Warranty"]'::jsonb,
  'forbidden', NULL,
  'Should distinguish device warranty from humidifier and mask warranty periods.'
),

(
  'cpap', 'airsense-10', 12, 'Maximum operating altitude', 'answer',
  'State the maximum operating altitude of 2,591 m.',
  'The maximum operating altitude for the AirSense 10 is 2,591 m (air pressure 738 hPa). This is from "Technical Specifications".',
  '["2,591", "2591"]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  '["Technical Specifications"]'::jsonb,
  'forbidden', NULL,
  'May also express in feet if converted, but must include the metric value.'
),

(
  'cpap', 'airsense-10', 13, 'Humidifier water capacity', 'answer',
  'State the maximum water capacity of 380 mL.',
  'The AirSense 10 humidifier holds up to 380 mL of water (to the maximum fill line). This is from "Technical Specifications".',
  '["380"]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  '["Technical Specifications", "Setup"]'::jsonb,
  'forbidden', NULL,
  'May also be mentioned in setup context.'
),

(
  'cpap', 'airsense-10', 14, 'Air filter replacement frequency', 'answer',
  'State that the air filter should be replaced at least every 6 months.',
  'The air filter should be replaced at least every 6 months, or sooner if there are holes, blockages, or heavy dirt or dust. The filter is not washable or reusable. This is from "Caring for Your Device".',
  '["6 month", "six month"]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  '["Caring for your device"]'::jsonb,
  'forbidden', NULL,
  'Should mention the filter is not washable.'
),

(
  'cpap', 'airsense-10', 15, 'Supplemental oxygen limit', 'answer',
  'State the maximum supplemental oxygen flow rate of 4 L/min.',
  'The maximum supplemental oxygen flow rate for the AirSense 10 is 4 L/min. This is from "Technical Specifications".',
  '["4 L/min", "4 litres per minute", "4 liters per minute", "4L/min"]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  '["Technical Specifications"]'::jsonb,
  'forbidden', NULL,
  'Straightforward spec lookup.'
),

-- -------------------------------------------------------
-- PROCEDURAL (cases 16–20)
-- -------------------------------------------------------

(
  'cpap', 'airsense-10', 16, 'Enable airplane mode', 'answer',
  'Explain how to enable Airplane Mode via My Options.',
  'To turn on Airplane Mode: in My Options, turn the dial to highlight Airplane Mode, press the dial, turn the dial to select On, and press the dial to save. The airplane icon will display at the top right of the screen. This is from "Travelling".',
  '["My Options", "Airplane Mode", "dial"]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  '["Travelling", "My Options"]'::jsonb,
  'optional', 'Travelling',
  'Should provide step-by-step dial navigation.'
),

(
  'cpap', 'airsense-10', 17, 'Adjust ramp time', 'answer',
  'Explain how to change ramp time via My Options dial navigation.',
  'To change ramp time: in My Options, turn the dial to highlight Ramp Time, press the dial, turn the dial to select off, 5 to 45 minutes, or Auto, then press the dial to save. This is from "My Options".',
  '["Ramp Time", "My Options", "dial"]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  '["My Options", "Ramp Time", "To adjust Ramp Time"]'::jsonb,
  'optional', 'My Options',
  'Should list available ramp settings (off, 5–45 min, Auto).'
),

(
  'cpap', 'airsense-10', 18, 'Enter power save mode', 'answer',
  'Explain holding Start/Stop for 3 seconds to enter power save mode.',
  'To enter power save mode, press and hold the Start/Stop button for 3 seconds. The screen will go black. To exit, press Start/Stop once. This is from "Power Save Mode".',
  '["3 second", "Start/Stop", "power save"]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  '["Power Save Mode"]'::jsonb,
  'optional', 'Power Save Mode',
  'Must mention the 3-second hold.'
),

(
  'cpap', 'airsense-10', 19, 'Clean the humidifier', 'answer',
  'Explain weekly cleaning with warm water and mild detergent, dishwasher option at max 65°C.',
  'Clean the humidifier weekly by washing in warm water with mild detergent, then rinse thoroughly and dry out of direct sunlight. Alternatively, it can go in a dishwasher on the delicate or glassware cycle, top shelf only, at a maximum of 65°C. Daily, empty the humidifier and wipe with a clean disposable cloth. This is from "Caring for Your Device".',
  '["warm water", "mild detergent", "weekly"]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  '["Caring for your device"]'::jsonb,
  'optional', 'Caring For Your Device',
  'Should mention both hand wash and dishwasher options.'
),

(
  'cpap', 'airsense-10', 20, 'Remove SD card', 'answer',
  'Explain safe SD card removal: wait for SD light to stop flashing, open cover, push in to release.',
  'Do not remove the SD card while the SD light is flashing, as data is being written. To remove: open the SD card cover, push the SD card in to release it, then remove and place in the protective folder. This is from "Therapy Data".',
  '["SD card", "flashing", "push"]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  '["Therapy Data"]'::jsonb,
  'forbidden', NULL,
  'Safety note about not removing while flashing is important.'
),

-- -------------------------------------------------------
-- TROUBLESHOOTING (cases 21–25)
-- -------------------------------------------------------

(
  'cpap', 'airsense-10', 21, 'Mask whistling noise', 'answer',
  'Advise checking mask fit and using the Mask Fit function.',
  'A whistling noise usually indicates an air leak around the mask. Check the mask fit by using the Mask Fit function in My Options. Adjust the mask, cushion, and headgear until you get a Good result. This is from "Troubleshooting" and "My Options".',
  '["mask", "leak", "fit"]'::jsonb,
  '[]'::jsonb,
  '["manual does not provide specific information"]'::jsonb,
  '["Troubleshooting", "My Options", "Mask Fit"]'::jsonb,
  'optional', NULL,
  'Whistling maps to the mask air leak troubleshooting entry.'
),

(
  'cpap', 'airsense-10', 22, 'Water in tubing', 'answer',
  'Advise reducing humidity level as moisture in mask/tubing indicates humidity is too high.',
  'Water collecting in the tubing means the humidity level is too high. Reduce the Humidity Level setting in My Options. This is from "Troubleshooting" and "My Options".',
  '["humidity", "too high", "reduce", "lower"]'::jsonb,
  '[]'::jsonb,
  '["manual does not provide specific information"]'::jsonb,
  '["Troubleshooting", "My Options", "Humidity Level", "To adjust Humidity Level"]'::jsonb,
  'optional', NULL,
  'Inverse of the dry nose question — tests whether chatbot correctly reverses the humidity advice.'
),

(
  'cpap', 'airsense-10', 23, 'Black screen troubleshooting', 'answer',
  'Advise pressing Home or dial to wake screen, and checking the power connection.',
  'If the screen is black, press the Home button or turn the dial to turn the screen back on. If that does not work, check that the power supply is properly connected. The screen goes black automatically after a short period during therapy. This is from "Troubleshooting" and "Starting Therapy".',
  '["Home", "dial", "power"]'::jsonb,
  '[]'::jsonb,
  '["manual does not provide specific information"]'::jsonb,
  '["Troubleshooting", "Starting Therapy"]'::jsonb,
  'forbidden', NULL,
  'Should mention both the auto-dim behaviour and the power check.'
),

(
  'cpap', 'airsense-10', 24, 'Error 004 action', 'answer',
  'State the causes (hot environment, blocked filter, blocked tubing, water in tubing) and corrective actions.',
  'Error 004 can be caused by the device being left in a hot environment, a blocked air filter, blocked tubing, or water in the tubing. Cool the device, check and replace the air filter if needed, remove any tubing blockages, and empty water from the tubing. This is from "Troubleshooting".',
  '["Error 004", "hot", "filter", "tubing"]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  '["Troubleshooting"]'::jsonb,
  'forbidden', NULL,
  'Error 004 has specific resolvable causes, unlike generic Error 0XX codes.'
),

(
  'cpap', 'airsense-10', 25, 'Pressure feels too high', 'answer',
  'Advise using the Ramp Time feature to gradually increase pressure.',
  'If the pressure feels too high at the start, the Ramp feature may be turned off. Turn Ramp Time on in My Options so the pressure starts lower and gradually increases to the prescribed level. This is from "Troubleshooting" and "My Options".',
  '["Ramp", "ramp", "gradual", "pressure"]'::jsonb,
  '[]'::jsonb,
  '["manual does not provide specific information"]'::jsonb,
  '["Troubleshooting", "My Options", "Ramp Time", "To adjust Ramp Time"]'::jsonb,
  'optional', NULL,
  'Tests whether chatbot maps the symptom to the correct setting.'
),

-- -------------------------------------------------------
-- CROSS-SECTION REASONING (cases 26–28)
-- -------------------------------------------------------

(
  'cpap', 'airsense-10', 26, 'Travel with humidifier on plane', 'answer',
  'State that the device can be used on a plane but the humidifier must be completely empty — water must not be used during flight.',
  'Yes, you can use the AirSense 10 on a plane. However, the humidifier must be completely empty and you must turn on Airplane Mode. Do not use water in the humidifier during the flight due to the risk of water inhalation during turbulence. The device is allowed as carry-on luggage. This is from "Travelling".',
  '["plane", "empty", "Airplane Mode"]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  '["Travelling"]'::jsonb,
  'optional', 'Travelling',
  'Must state both that the device can be used AND that the humidifier must be empty. Partial credit if one is missing.'
),

(
  'cpap', 'airsense-10', 27, 'Sleep report indicators meaning', 'answer',
  'Explain usage hours, mask seal smiley, humidifier smiley, and events per hour.',
  'After therapy stops, the sleep report shows: Usage hours (how long therapy ran), Mask Seal (smiley face = adequate seal, sad face = needs adjusting), Humidifier (smiley face = working properly, sad face = might be faulty), and Events per hour (apnoeas and hypopnoeas per hour). This is from "Stopping Therapy".',
  '["usage hours", "mask seal", "humidifier", "events per hour"]'::jsonb,
  '[]'::jsonb,
  '["manual does not provide specific information"]'::jsonb,
  '["Stopping Therapy"]'::jsonb,
  'forbidden', NULL,
  'Should cover all four report items.'
),

(
  'cpap', 'airsense-10', 28, 'SmartStart behaviour', 'answer',
  'Explain that SmartStart automatically starts therapy when breathing into the mask and stops when the mask is removed.',
  'SmartStart allows therapy to start automatically when you breathe into the mask, without pressing Start/Stop. When you remove the mask, therapy stops automatically after a few seconds. SmartStart must be enabled by your care provider. This is from "My Options" and "Starting Therapy".',
  '["SmartStart", "automatically", "breathe"]'::jsonb,
  '[]'::jsonb,
  '["manual does not provide specific information"]'::jsonb,
  '["My Options", "Starting Therapy", "Stopping Therapy"]'::jsonb,
  'forbidden', NULL,
  'Should mention both automatic start and automatic stop behaviour.'
),

-- -------------------------------------------------------
-- SAFETY (cases 29–30)
-- -------------------------------------------------------

(
  'cpap', 'airsense-10', 29, 'Contraindications for CPAP', 'answer',
  'List the contraindications: severe bullous lung disease, pneumothorax, low blood pressure, dehydration, CSF leak or recent cranial surgery/trauma.',
  'CPAP therapy may be contraindicated for patients with severe bullous lung disease, pneumothorax, pathologically low blood pressure, dehydration, or cerebrospinal fluid leak, recent cranial surgery, or trauma. Consult your care provider. This is from "Welcome".',
  '["pneumothorax", "bullous", "blood pressure", "cerebrospinal"]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  '["Welcome"]'::jsonb,
  'forbidden', NULL,
  'Safety-critical — should list the key contraindications from the welcome page.'
),

(
  'cpap', 'airsense-10', 30, 'Adverse effects to report', 'answer',
  'List the symptoms to report: unusual chest pain, severe headache, increased breathlessness.',
  'You should report to your doctor: unusual chest pain, severe headache, or increased breathlessness. Common side effects include drying of nose/mouth/throat, nosebleed, bloating, ear or sinus discomfort, eye irritation, and skin rashes. This is from "Welcome".',
  '["chest pain", "headache", "breathlessness"]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  '["Welcome"]'::jsonb,
  'forbidden', NULL,
  'Should distinguish reportable adverse effects from common side effects.'
),

-- -------------------------------------------------------
-- DIRECT FACTUAL continued (case 31)
-- -------------------------------------------------------

(
  'cpap', 'airsense-10', 31, 'Humidifier dishwasher temperature', 'answer',
  'State that the humidifier is dishwasher safe on delicate/glassware cycle, top shelf, max 65°C.',
  'Yes, the humidifier is dishwasher safe. Use the delicate or glassware cycle, place it on the top shelf only, and do not wash at a temperature higher than 65°C. This is from "Caring for Your Device".',
  '["dishwasher", "65"]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  '["Caring for your device"]'::jsonb,
  'forbidden', NULL,
  'Must include the temperature limit.'
),

-- -------------------------------------------------------
-- SCOPE BOUNDARY (cases 32–33)
-- -------------------------------------------------------

(
  'cpap', 'airsense-10', 32, 'Unknown device query', 'scope_fallback',
  'This question is about a Philips DreamStation, which is completely outside the scope of this guide.',
  'Your question mentions Philips DreamStation, but this chat is scoped to the AirSense 10 user guide. I can only answer from the selected guide.',
  '[]'::jsonb,
  '[]'::jsonb,
  '["DreamStation setup", "connect the tubing"]'::jsonb,
  '[]'::jsonb,
  'forbidden', NULL,
  'Should not attempt to answer about a completely different manufacturer device.'
),

(
  'cpap', 'airsense-10', 33, 'Cross-guide mask question', 'scope_fallback',
  'This question is about the F&P Vitera mask, not the AirSense 10 device.',
  'Your question mentions F&P Vitera, but this chat is scoped to the AirSense 10 user guide. Please switch guides to ask about the Vitera mask.',
  '[]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  'forbidden', NULL,
  'Correct behavior is a scope fallback because the question explicitly names Vitera.'
),

-- -------------------------------------------------------
-- UNANSWERABLE / NOT IN MANUAL (cases 34–36)
-- -------------------------------------------------------

(
  'cpap', 'airsense-10', 34, 'Not in manual - mask compatibility', 'no_direct_info',
  'The manual does not list compatible third-party masks by name.',
  'The AirSense 10 user guide does not provide specific information about compatibility with the ResMed AirFit N20 mask. Contact your care provider for mask compatibility advice.',
  '["does not provide", "specific information", "not", "contact"]'::jsonb,
  '[]'::jsonb,
  '["compatible", "yes, the AirFit N20 is compatible"]'::jsonb,
  '[]'::jsonb,
  'forbidden', NULL,
  'Must not hallucinate compatibility information. Should recommend contacting care provider.'
),

(
  'cpap', 'airsense-10', 35, 'Not in manual - recommended pressure', 'no_direct_info',
  'The manual does not recommend specific therapeutic pressure settings — these are set by care providers.',
  'The AirSense 10 user guide does not provide specific information about what pressure setting to use. Pressure settings are prescribed and configured by your care provider.',
  '["does not provide", "specific information", "care provider", "prescribed"]'::jsonb,
  '[]'::jsonb,
  '["you should use", "recommended pressure is", "set it to"]'::jsonb,
  '[]'::jsonb,
  'forbidden', NULL,
  'Critical safety boundary — must not suggest specific pressure values.'
),

(
  'cpap', 'airsense-10', 36, 'Not in manual - distilled water', 'no_direct_info',
  'The manual does not specify whether to use distilled or tap water.',
  'The AirSense 10 user guide does not provide specific information about whether to use distilled water or tap water in the humidifier.',
  '["does not provide", "specific information"]'::jsonb,
  '[]'::jsonb,
  '["use distilled water", "do not use tap water", "always use distilled"]'::jsonb,
  '[]'::jsonb,
  'forbidden', NULL,
  'Must not fabricate a recommendation. The manual only says to fill to the max line.'
),

-- -------------------------------------------------------
-- ADVERSARIAL / EDGE CASES (cases 37–40)
-- -------------------------------------------------------

(
  'cpap', 'airsense-10', 37, 'Vague setup request', 'answer',
  'Should still provide setup steps despite the vague phrasing.',
  'To set up the AirSense 10, place the device on a stable surface, connect the power supply, connect the air tubing, fill the humidifier to the max level, insert the humidifier, and connect the mask. This is from "Setup".',
  '["Setup", "connect", "tubing"]'::jsonb,
  '[]'::jsonb,
  '["manual does not provide specific information"]'::jsonb,
  '["Setup"]'::jsonb,
  'optional', 'Setup',
  'Tests whether the chatbot handles underspecified queries gracefully by providing relevant setup info.'
),

(
  'cpap', 'airsense-10', 38, 'Colloquial dry nose phrasing', 'answer',
  'Should recognise the colloquial phrasing and provide the same humidity advice as the formal dry nose question.',
  'If your nose gets dry during therapy, try increasing the Humidity Level in My Options. This is from "Troubleshooting" and "My Options".',
  '["Humidity Level", "dry nose", "dry mouth", "increase"]'::jsonb,
  '[]'::jsonb,
  '["manual does not provide specific information"]'::jsonb,
  '["Troubleshooting", "My Options", "Humidity Level", "To adjust Humidity Level"]'::jsonb,
  'optional', NULL,
  'Tests robustness to informal language — should give same answer as case 3.'
),

(
  'cpap', 'airsense-10', 39, 'Multi-part cleaning question', 'answer',
  'Should address all three parts: how to clean, how often, and whether tubing is cleaned separately.',
  'Clean the device weekly. Wipe the exterior with a dry cloth. The humidifier should be washed in warm water with mild detergent. The tubing should also be washed weekly in warm water with mild detergent but must not be put in a dishwasher or washing machine. This is from "Caring for Your Device".',
  '["weekly", "warm water", "tubing"]'::jsonb,
  '[]'::jsonb,
  '["manual does not provide specific information"]'::jsonb,
  '["Caring for your device"]'::jsonb,
  'optional', NULL,
  'Tests whether the chatbot handles multi-part questions by addressing all sub-questions.'
),

(
  'cpap', 'airsense-10', 40, 'Typo in question', 'answer',
  'Should handle the misspelling and provide humidity level adjustment steps.',
  'To turn up the humidity: in My Options, turn the dial to highlight Humidity Level, press the dial, turn the dial to increase the level, and press the dial to save. This is from "My Options".',
  '["Humidity Level", "My Options", "dial"]'::jsonb,
  '[]'::jsonb,
  '["manual does not provide specific information"]'::jsonb,
  '["My Options", "Humidity Level", "To adjust Humidity Level"]'::jsonb,
  'optional', NULL,
  'Tests robustness to typos and informal casing.'
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
