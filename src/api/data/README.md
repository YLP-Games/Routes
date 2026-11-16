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

**November 2026 is complete:** all 8 zone×grade rows (2 zones × 4 grades) are on file. The inland
`diesel50ppm` (0.005% sulphur) wholesale price is **R32.09/L**, effective 2026-11-04 — reconciled
from the October inland price of R33.29 less the announced 119.82c/L drop and verified against the
gov.za DMPR media statement for prices effective 4 November 2026, with The Citizen's report as a
supporting source. Diesel figures are regulated **wholesale** prices, not retail.

If the table falls behind (the first Wednesday of a month passes and that month has no rows),
trips priced at `current` carry a "Fuel prices may be out of date" warning.

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

### How the fuel figures reach TomTom

TomTom's combustion model takes a speed → L/100km curve (`constantSpeedConsumptionInLitersPerHundredkm`)
and, when `vehicleWeight` and the efficiency parameters are sent, adds energy for speed changes
(`acceleration`/`decelerationEfficiency`) and for hills (`uphill`/`downhillEfficiency`).

Our curve (`buildConsumptionCurve`) is a **drive-cycle average**, not a steady-cruise curve: its
low-speed points come from the urban figure (crawl 1.2×, 30 km/h 0.92× urban), which already
includes stop-start acceleration losses, 70–90 km/h sit on the extra-urban figure, and above
100 km/h it rises for air drag (1.08× at 110, 1.26× at 130). So that acceleration is not counted
twice, the API sends speed-change efficiencies of 1/1 (energy-neutral) and keeps TomTom's
recommended hill efficiencies (0.27 uphill, 0.51 downhill), so climbs cost fuel in proportion to
the vehicle's weight. With TomTom's default speed-change efficiencies (0.33/0.83) its speed-change
term alone added about 3.5 L/100km to a Polo Vivo on the Joburg–Pretoria highway, even with a pure
steady-cruise curve, which is why it is switched off rather than paired with a cruise curve.

Calibration (live TomTom, October 2026, Polo Vivo 1.4, combined 5.9): Joburg → Pretoria ≈ 7.0,
Soweto → Rosebank → Kempton Park ≈ 8.2, Cape Town → Stellenbosch ≈ 6.5 L/100km. Without a vehicle
weight (custom consumption only), no efficiency parameters are sent and TomTom uses the curve alone.
The offline fallback model (`fallbackLitres`) gives about the same figure at the same average speed.

To add a vehicle, give it a unique kebab-case `id`, fill in every `Vehicle` field and run the
tests.
