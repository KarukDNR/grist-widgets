# Timesheet widget

Prints a Karuk Tribe timesheet from the existing Grist paid-hours tables. No build step, API key, or document ID. Grist remains responsible for row and daily totals. This widget only reads data; it calls no write APIs. Cross-table fetching requires Grist's **Full document access**, which also permits writes at the platform level.

## Install

1. Publish this repository with GitHub Pages from `main` / root after reviewing and merging the draft.
2. Create a **Print Timesheet** page with a selector table using **Hours [by Who, Pay_period_end]** (`Hours_summary_Pay_period_end_Who`).
3. Add a Custom widget using the same summary table. Set **Select By** to the selector widget, so its selected row supplies `Who` and `Pay_period_end`. Include those columns; do not configure column mappings.
4. Set its URL to `https://karukdnr.github.io/grist-widgets/timesheet/` and grant **Full document access**.
5. Select an employee/period; check the preview. Click **Refresh** after edits in other tables. Click **Print / Save PDF**, or use Grist's **Print widget** menu.
6. Choose Letter, portrait, 100% scale, enable background graphics, and disable browser headers/footers. Use Save as PDF. Printing the entire Grist page is not the intended output.

The built-in button calls `window.print()` inside the widget. If a browser or Grist iframe policy blocks that call, use Grist's **Print widget** menu. Actual embedded printing needs verification in your Grist installation.

## Data contract

| Source | Fields |
| --- | --- |
| Selected summary record | `Who`, `Pay_period_end` references |
| `Hours_paid` | `Who`, `Pay_period_end`, `Fund`, `Hours_type`, `Sun1` through `Sat2`, `Total_hours` |
| `Hours_paid_summary_Who_and_pay_period` | `group`, 14 daily totals, `Total` |
| `Staff` | `Name`, `Title`; optional `Program` |
| `Funds` | `Name`, `Code` |
| `Pay_periods` | `Start_date`, `End_date`; optional `Pay_date` |

The existing summary groups by `Who_and_pay_period`, whose type/default differs between the task and paid-hours tables in the provided schema. The widget avoids interpreting that key: it matches the summary's `group` membership against the selected paid-hours row IDs. Summary source membership is normally available as `group` via `fetchTable`. If that field is absent, use a paid-hours summary grouped directly by `Who` and `Pay_period_end` and change `tables.totals` in `config.js`. One exact matching summary is required; the widget never silently substitutes calculated totals.

All matching paid-hour rows are shown in source row order, including zero-hour rows. Blank numeric cells display empty; zeros in detail rows display empty, while total zeros display `0`. Errors in required numeric values block printing. The form expects a 14-day Sunday–Saturday period. It pads to eleven fund/status rows, matching the example, and permits longer reports to span pages rather than silently dropping rows.

## Optional fields and assets

- **Letterhead:** add `assets/letterhead.png`; see `assets/README.md`. Until available, the heading is plain text.
- **PP Date:** add `Pay_date` (Date) to `Pay_periods`, or update `payDateColumn` to the correct field ID. It is blank by default; it is not guessed from PP Ends.
- **Program:** defaults to `DNR` in `config.js`; an optional `Staff.Program` overrides it.
- **Holidays:** create `Holidays` with a `Date` field and set `tables.holidays` to `'Holidays'`. Alternatively set `holidayDates` to ISO date strings. Holiday shading overrides weekend gray. No holidays are assumed in live data.

## Preview and verification

Run `python3 -m http.server 8000` from the repo root and open `http://localhost:8000/timesheet/?demo=1`. The standalone demo uses fictional data and displays a DEMO label. Inside Grist, demo mode is disabled even if the query parameter is present.

Typical eleven-row output is intended to fit one portrait Letter page. A live Grist connection and its print menu cannot be verified from a standalone preview.
