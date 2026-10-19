# API data files

## `fuelPrices.za.json` — South African regulated fuel prices

South Africa's Department of Mineral and Petroleum Resources (DMPR) changes fuel prices once a
month. The new prices start on the **first Wednesday of the month** (at 00:01), and the
department usually announces them on the Sunday or Monday before.

Each row is a `FuelPrice` (see `src/shared/types.ts`):

```json
{ "month": "2026-11", "effectiveDate": "2026-11-04", "zone": "inland", "fuel": "petrol95",
  "randsPerLitre": 31.10, "source": "https://www.gov.za/... (DMPR, 2026-11-02)" }
```

### Adding next month's prices

1. Find the DMPR media statement on gov.za ("Minister ... announces adjustment of fuel prices
   effective from ..."). It gives the change in c/l for each grade. The actual prices per zone
   come from the department's published schedule or from reliable reports (AA South Africa,
   BusinessTech, TimesLIVE).
2. Add one row per zone and grade: `inland` (Gauteng) and `coastal`, each with `petrol93`,
   `petrol95`, `diesel500ppm` (0.05% sulphur) and `diesel50ppm` (0.005% sulphur).
   - Set `effectiveDate` to the first Wednesday of the month (`YYYY-MM-DD`).
   - All rows for a month must share the same `effectiveDate`.
   - Diesel prices are regulated **wholesale** prices, because retail diesel is not regulated.
     Say so in `source`. The API also warns the user about it.
   - Check the numbers: last month's price plus the announced change should give the new price.
     Never guess a figure. Leave out any row you can't verify. The API then falls back to the
     other zone's price and returns a warning.
3. Run `npx vitest run --project api`. The data-integrity tests check the format and look for
   duplicate rows.

`current` means the newest month whose `effectiveDate` has passed in South African time, so
there's no need to change any code when a new month starts. `previous` is the month listed just
before `current`.

## `vehicles.sa.json` — vehicle catalogue

These are popular South African models with the manufacturer's claimed consumption in L/100km.
When the manufacturer only publishes a combined figure, the urban and extra-urban figures are
calculated from it (urban = combined × 1.3, extra-urban = combined × 0.85), and `source` says
so. `massKg` is the approximate kerb mass. The API adds 80 kg for the driver and a light load.
The fuel model multiplies all catalogue figures by `REAL_WORLD_FACTOR`, which is 1.15
(`src/api/services/fuelModel.ts`), because lab figures understate real-world use. A consumption
the user enters (`customConsumptionL100km`) is treated as a real-world figure and is not scaled.
It is used as the steady-cruise figure (about 70–90 km/h with no traffic), and the urban figure is
taken as 1.3 times it, so slower and congested trips still come out a little higher.

To add a vehicle, give it a unique kebab-case `id`, fill in every `Vehicle` field and run the
tests.
