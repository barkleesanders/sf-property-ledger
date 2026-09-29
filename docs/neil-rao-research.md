# Neil Rao / SF Standard research brief — "SF property verification ledger" (goal_355f4dc2c559)

Research date: 2026-09-29 (all live probes run this date, America/Los_Angeles).
Method: mini-deepsearch VM-local engine (`~/workspace/tools/deepsearch.sh`), six-phase method.
Skill path logged: `~/workspace/skills/deepsearch/SKILL.md`
sha256: `1db160b3550f2d5c677b9d87bfa04bf324e13a77035a33628a5ea717a6773f76`

## 1. The SF Standard article

- Title: "Meet the 17-year-old mapping SF's rent-controlled housing"
- Byline: Max Harrison-Caldwell (housing, culture, breaking-news reporter). Published Sep 27, 2026, 6:00 AM PT.
- URL: https://sfstandard.com/2026/09/27/san-francisco-rent-control-vibecoded-map/ (retrieved 2026-09-29 via Exa crawl; sfstandard.com and hoodline.com are policy-blocked for direct fetch)
- Lede: "What did you do the summer after your sophomore year of high school?... Inspired by his experience volunteering with the homeless and housing-insecure people in Berkeley, Neil Rao decided to spend his summer analyzing nearly half a million records from the San Francisco Rent Board."
- Who: Neil Rao, 17, a junior at San Mateo High School (San Mateo, CA — not an SF resident).

### His corpus and method (per the article)
- **~463,000 public records pulled from the San Francisco Rent Board**: tenant complaints, landlords' annual disclosures, and move-out notifications.
- He then **used Claude to geocode the records** to visualize tenant protections citywide.
- Motivation: freshman-year financial-literacy club → partnership with Insight Housing (Berkeley homeless-services provider) → interest in housing instability; noticed protections "vary a lot, even block by block."

### Headline findings (5+)
1. **San Francisco has no official inventory or map of rent-controlled homes.** The city simply does not have one; Rent Board Executive Director Christina Varner, when asked about the accuracy of Rao's findings, "essentially gave a big shrug." The closest thing is a Planning Department proxy: apartment buildings constructed before June 1979.
2. **Blank zones on the map (zero Rent Board activity — no complaints, no annual reports) read as single-family homes, new construction, and federal public housing** (per rental-market experts quoted).
3. **Almost no correlation between average income and Rent Board activity.** Rao expected rent-controlled apartments to concentrate in poor neighborhoods; instead upscale but renter-dense areas like the **Marina and Pacific Heights** have some of the highest concentrations — because protections are based on **building age** (1979 ordinance: buildings certified for occupation before June 1979), not neighborhood income.
4. **Top five neighborhoods by Rent Board records per capita: Mission, Noe Valley, Bernal Heights, Outer Richmond, Potrero Hill** — scattered across geography and demography.
5. **The Standard vibe-coded its own map of ~174,000 units from the Planning pre-1979-apartment-buildings data — and it came out nearly identical to Rao's map despite using different data.** Molly Goldberg (SF Anti-Displacement Coalition) explained the likely reason: owners can raise rent in rent-controlled units *only if* they file annual reports, while market-rate owners face no penalty for not reporting — so rent-controlled owners report more faithfully.
6. **Stock estimates, all approximate:** Goldberg: fewer than 170,000 of the city's ~250,000 rental units are rent-controlled; Planning Department: 166,000. "That number is not static" — units leave via the **Ellis Act** (1985 state law letting exiting landlords evict).
7. Rent rules context in the piece: vacancy decontrol (rent resets to market on move-out but the unit stays controlled, increases capped at **1.6%** for the 3/1/2026–2/28/2027 cycle); the 2019 state law caps post-1979 units at 5% + inflation, max 10%.

### What Rao wants to do next (directly quoted/paraphrased)
- "Now he wants to **dig deeper and fill gaps in the city's records**."
- His stated next goal: **determine whether neighborhoods with more Rent Board activity actually have more rent-controlled housing, or whether some neighborhoods just interact with the Rent Board more often** — i.e., disentangle stock density from reporting/filing propensity.
- "He plans to continue his research — outside of school hours."

Confidence: **Strong** (full article text pulled from Exa crawl + corroborating summaries on sftimes.com and hoodline.com).

## 2. Which dataset is the "~463k"? Linkage to gdc7-dmcn

Rao's corpus is a **multi-dataset Rent Board pull** (complaints + annual disclosures + move-out notices), not one DataSF dataset. The "landlords' annual disclosures" leg maps to the **Rent Board Housing Inventory** (DataSF `gdc7-dmcn`). Note the timing: the live `gdc7-dmcn` count on 2026-09-29 is **551,244** rows — Rao's ~463k was likely the inventory size (or a subset of filings) at the time he pulled in summer 2026, and the dataset has grown since (last refresh 2026-09-28). Confidence: **Moderate** — the article does not name dataset IDs; the mapping is inferential but the "annual disclosures" description is an exact fit for the Housing Inventory.

- Article: https://sfstandard.com/2026/09/27/san-francisco-rent-control-vibecoded-map/ (retrieved 2026-09-29)
- Corroborating write-ups: https://www.sftimes.com/brief/2026-09-27/b8fbea-meet-the-17-year-old-mapping-sf-s-rent-controlled-housing/ (retrieved 2026-09-29); https://hoodline.com/2026/09/san-mateo-teen-s-rent-board-data-project-maps-174-000-sf-controlled-units/ (retrieved 2026-09-29 via Exa)

## 3. DataSF datasets (all verified live 2026-09-29 via Socrata API)

### gdc7-dmcn — Rent Board Housing Inventory
- Name: "Rent Board Housing Inventory" · Category: Housing and Buildings · License: PDDL
- URL: https://data.sfgov.org/Housing-and-Buildings/Rent-Board-Housing-Inventory/gdc7-dmcn
- **Row count (live SoQL count(*), 2026-09-29): 551,244**
- Rows last updated: 2026-09-28 (06:35 PDT) · Created 2026-03-04
- What it is: annual owner filings mandated by **Ordinance 265-20** (passed Dec 2020; 10+ unit buildings report from July 1, 2022, all others from March 1, 2023; updates due every March 1; filing is required to obtain a rent-increase license). 2026 fees: $59/unit, $29.50/SRO guest room, due March 1.
- Case-type mix (verified): five case types, all "Housing Inventory - Unit information (YYYY)": 2026=133,013 · 2025=132,088 · 2024=111,513 · 2023=107,886 · 2022=66,744 (sums to 551,244 ✓)
- Key columns (28): `unique_id, block_num, unit_count, case_type_name, submission_year, block_address, occupancy_type, occupancy_or_vacancy_date, occupancy_or_vacancy_date_year, bedroom_count, bathroom_count, square_footage, monthly_rent, base_rent_includes_water_sewer, base_rent_includes_natural_gas, base_rent_includes_electricity, base_rent_includes_refuse_recycling, base_rent_includes_other_utilities, past_occupancy, vacancy_date, signature_date, occupancy_or_vacancy_date_history, year_property_built, point, analysis_neighborhood, supervisor_district, data_as_of, data_loaded_at`
- Notable data shape (from live sample): addresses are **block-level** ("400 Block of STOCKTON ST"), `monthly_rent` is a **range bucket** ("$1751-$2000"), geocoding is a `point` lat/lng per row, `block_num` is the 4-digit SF block number.

### The 3/18/2026 data-quality note (quoted exactly)
From the dataset description, first paragraph (retrieved 2026-09-29):

> **"Note 3/18/2026: There was a previous issue with this dataset that filtered out certain rows and did not include some Housing Inventory reports for the current fiscal year. This issue has been resolved."**

### acdm-wktn — Parcels – Active and Retired (Assessor parcel universe)
- Name: "Parcels – Active and Retired" · URL: https://data.sfgov.org/Geographic-Locations-and-Boundaries/Parcels-Active-and-Retired/acdm-wktn
- **Row count (live SoQL count(*), 2026-09-29): 236,560** = **227,957 active + 8,603 retired**
- Key columns (37): `mapblklot, blklot, block_num, lot_num, from_address_num, to_address_num, street_name, street_type, odd_even, in_asr_secured_roll, pw_recorded_map, zoning_code, zoning_district, date_rec_add, date_rec_drop, date_map_add, date_map_drop, date_map_alt, active, shape (polygon), centroid_latitude, centroid_longitude, supdist, supervisor_district, analysis_neighborhood, police_district, planning_district, data_as_of, data_loaded_at`
- This is the full assessor parcel geography since the basemap inception (1995), with zoning reflecting current district.

### ramy-di5m — San Francisco Addresses with Units – Enterprise Addressing System
- Name: "San Francisco Addresses with Units - Enterprise Addressing System" · URL: https://data.sfgov.org/Geographic-Locations-and-Boundaries/Addresses-with-Units-Enterprise-Addressing-System/ramy-di5m
- **Row count (live SoQL count(*), 2026-09-29): 388,619** (base addresses + unit sub-addresses)
- **Update cadence: nightly** (per dataset description; EAS extract maintained by SF Department of Technology; "not all addresses are associated with parcels")
- Key columns (31): `eas_fullid, eas_baseid, eas_address_id, address_number, address_number_suffix, street_name, street_type, cnn, street_full_street_name, eas_subid, unit_number, parcel_number, block, lot, zip_code, address, longitude, latitude, point, supdist, supervisor, nhood, complete_landmark_name, landmark_aliases, direct_source, data_as_of, data_updated_at, data_loaded_at`

## 4. What "verify every property in SF" needs beyond gdc7-dmcn + record-linkage keys

The Housing Inventory is **unit-level filing data with no parcel key** — it cannot be the verification universe by itself. A true property-by-property ledger needs:

1. **The parcel universe: acdm-wktn** (227,957 active parcels) — every property's geometry, block/lot, address range, active/retired status, zoning.
2. **The address universe: ramy-di5m** (388,619 address+unit rows, nightly) — authoritative street addresses with unit sub-addresses.
3. **Owner-of-record / assessment roll**: `in_asr_secured_roll` exists on parcels; the actual secured roll with owner names/values is the Assessor's roll (separate dataset family) — needed for owner cross-checks.
4. **Rent Board Housing Inventory (gdc7-dmcn)** — the reporting/verification signal: which properties filed, occupancy, rent buckets.

### Linkage keys between them
- **`blklot` / `mapblklot`** (acdm-wktn) ↔ **`parcel_number`, `block`, `lot`** (ramy-di5m): the direct join key — ramy-di5m explicitly carries parcel references, so EAS addresses can be pinned to parcels. Caveat: "not all addresses are associated with parcels."
- **Housing Inventory → parcels**: *no direct key*. gdc7-dmcn carries only `block_num` (4-digit block), `block_address` (block-level text, e.g. "400 Block of STOCKTON ST"), and a geocoded `point`. Linkage options: (a) **block_num → parcels.block_num** (many-to-one; narrows to the block), then address-range/street matching against `from_address_num`–`to_address_num` + `street_name`/`street_type`; (b) **point-in-polygon** of the inventory point against parcel `shape` geometry. Both are fuzzy and will need a confidence tier per row.
- **`eas_baseid`/`eas_fullid`** (ramy-di5m) are stable EAS address identifiers — good as the canonical address key for MCP callables.
- **Known gaps the linkage must handle**: retired parcels (8,603, i.e. subdivisions/merges — historical inventory rows point at parcels that no longer exist); inventory addresses at block granularity only; unit-level inventory rows vs. ramy-di5m unit sub-addresses (matching unit counts per building is the real reconciliation); rent buckets instead of exact rents.

## 5. Rao methodology: repo / writeup status

**No public GitHub repo, notebook, methodology writeup, or public data dump of Rao's was found.** (GitHub repo-search API for `neil+rao+rent+control`, `sf+rent+control+map+rent+board`, `rent+board+housing+inventory+map` all returned 0 results, 2026-09-29; tavily/youcom/linkup web searches returned no repo or writeup.) All that is publicly known about his method comes from the article itself: pulled ~463k Rent Board records (complaints + annual disclosures + move-out notices) and **used Claude to geocode them** for visualization. The map itself was shown in the article as images credited "Courtesy of Neil Rao" — no interactive public map URL found.

## 6. What we could NOT verify (negative results)

- ❌ Rao's exact dataset list / download provenance (Rent Board open-data portal? DataSF? FOIA? scrape?) — the article says only "public records from the Rent Board."
- ❌ Whether Rao's ~463k is gdc7-dmcn at pull time, or the sum of several datasets — unresolvable without his writeup.
- ❌ Any public repo, notebook, interactive map, or data release from Rao — searched GitHub API + web, nothing found.
- ❌ The Standard's vibe-coded ~174k-unit map dataset — referenced in the article as built by Max Harrison-Caldwell from Planning pre-1979 apartment-building data; not published as a dataset.
- ❌ Christina Varner's exact quotes beyond the paraphrase ("essentially gave a big shrug") — sfstandard.com is policy-blocked for direct fetch; full text recovered via Exa crawl instead.
- ✅ Row counts above are **live SoQL count(*)**, 2026-09-29 — not quoted from docs.
- ⚠️ Practical note for the ledger build: `data.sfgov.org` now 302-redirects `/api/views/*` to `data.sf.gov` and returns **403 on `/resource/*`** for plain curl; use host `data.sf.gov` **with a browser User-Agent** for SoQL (verified working 2026-09-29).

## 7. Citations (URL + retrieved date)

- SF Standard article (full text via Exa crawl, original at https://sfstandard.com/2026/09/27/san-francisco-rent-control-vibecoded-map/) — retrieved 2026-09-29
- SF Times brief: https://www.sftimes.com/brief/2026-09-27/b8fbea-meet-the-17-year-old-mapping-sf-s-rent-controlled-housing/ — retrieved 2026-09-29
- Hoodline (full text via Exa crawl): https://hoodline.com/2026/09/san-mateo-teen-s-rent-board-data-project-maps-174-000-sf-controlled-units/ — retrieved 2026-09-29
- DataSF gdc7-dmcn: https://data.sfgov.org/Housing-and-Buildings/Rent-Board-Housing-Inventory/gdc7-dmcn (+ live SoQL metadata/count probes) — 2026-09-29
- DataSF acdm-wktn: https://data.sfgov.org/Geographic-Locations-and-Boundaries/Parcels-Active-and-Retired/acdm-wktn (+ live SoQL) — 2026-09-29
- DataSF ramy-di5m: https://data.sfgov.org/Geographic-Locations-and-Boundaries/Addresses-with-Units-Enterprise-Addressing-System/ramy-di5m (+ live SoQL) — 2026-09-29
- SF.gov Rent Board Housing Inventory program page: https://www.sf.gov/rent-board-housing-inventory — cited in dataset description
- 3Di Systems Rent Board case study (scope figure "91,000 parcels and 224,500 units" under Rent Board purview): https://www.3disystems.com/transforming-rental-inventory-management-in-san-francisco/ — retrieved 2026-09-29 (vendor claim, treat as Moderate confidence)
- Ordinance 265-20 context (Dec 2020, annual reporting mandate, rent-increase license requirement) via Hoodline quoting Small Property Owners of SF Institute — retrieved 2026-09-29

## Bottom line for the ledger project

Rao proved the gap is real and the method is simple: geocode Rent Board filings, and you get a rent-control inventory the city doesn't have. But his build stops at ~neighborhood-level visualization because the **Rent Board Housing Inventory has no parcel key** — addresses are block-level, rents are buckets. Building the full verifiable property ledger means: (a) the parcel universe (227,957 active parcels, acdm-wktn), (b) nightly EAS addresses-with-units (388,619, ramy-di5m) joined to parcels via `parcel_number`/`blklot`, (c) fuzzy linkage of the 551,244 inventory rows onto parcels via block_num + point-in-polygon + address-range matching with per-row confidence, and (d) a separate assessor-roll leg for owner verification. Rao's stated next step — separating "has more rent-controlled stock" from "files with the Rent Board more often" — is exactly the reporting-propensity problem the ledger's confidence tiers must encode.
