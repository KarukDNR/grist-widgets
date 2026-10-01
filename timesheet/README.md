# Timesheet widget

Prints a Karuk Tribe timesheet from the existing Grist paid-hours tables. No build step, API key, or document ID. Grist remains responsible for row and daily totals. This widget only reads data; it calls no write APIs. Cross-table fetching requires Grist's **Full document access**, which also permits writes at the platform level.

## Install

1. Publish this repository with GitHub Pages from `main` / root after merging the changes.
2. Create a **Print Timesheet** page with a selector table using **Timesheets**, with one row per employee/pay period.
3. Add a Custom widget using **Timesheets** as its data table. Set **Select By** to the selector widget, so its selected row supplies its `id`, `Who`, and `Pay_period_end`. Include those columns; do not configure column mappings.
4. Set its URL to `https://karukdnr.github.io/grist-widgets/timesheet/` and grant **Full document access**.
5. Select an employee/period; check the preview. Click **Refresh** after edits in other tables. Click **Print / Save PDF**, or use Grist's **Print widget** menu.
6. Choose Letter, portrait, 100% scale, enable background graphics, and disable browser headers/footers. Use Save as PDF. Printing the entire Grist page is not the intended output.

The built-in button calls `window.print()` inside the widget. If a browser or Grist iframe policy blocks that call, use Grist's **Print widget** menu. Actual embedded printing needs verification in your Grist installation.

## Data contract

| Source | Fields |
| --- | --- |
| Selected `Timesheets` record | `id`, `Who` (Reference to Staff), `Pay_period_end` (Reference to Pay_periods) |
| `Hours_paid` | `Timesheets` (stored Reference to Timesheets), `Fund`, `Hours_type`, `Sun1` through `Sat2`, `Total_hours` |
| Paid-hours summary configured in `tables.totals` | `Timesheets` reference or `group`, 14 daily totals, `Total` |
| `Staff` | `Name`, `Title`; optional `Program` |
| `Funds` | `Name`, `Code` |
| `Pay_periods` | `Start_date`, `End_date`; optional `Pay_date` |

Paid rows are selected by their stored `Hours_paid.Timesheets` reference matching the selected Timesheets row ID. The widget does not use concatenated employee/period keys or require the paid table's derived `Who` and `Pay_period_end` columns. If the reference column has a different ID, set `timesheetColumn` in `config.js`.

Set `tables.totals` to the actual paid-hours summary table ID from Grist Raw Data. The existing default is retained for documents that kept that summary. A summary grouped by `Timesheets` is matched directly by that reference. Otherwise, exact `group` membership is matched against the selected paid row IDs; a summary with neither of those fields can be matched by `Who` and `Pay_period_end`. One exact matching summary is required; totals are always read from Grist.

In Grist, keep `Hours_paid.Timesheets` as a data Reference, and derive `Who` and `Pay_period_end` from it if needed elsewhere. Link the paid-hours entry widget to the Timesheets selector through that data reference so new rows inherit it. Link this print widget directly to the same Timesheets selector using Timesheets as its data table.

All matching paid-hour rows are shown in source row order, including zero-hour rows. Blank numeric cells display empty; zeros in detail rows display empty, while total zeros display `0`. Errors in required numeric values block printing. The form expects a 14-day Sunday–Saturday period. It pads to eleven fund/status rows, matching the example, and permits longer reports to span pages rather than silently dropping rows.

## Optional fields and assets

- **Letterhead:** add `assets/letterhead.png`; see `assets/README.md`. Until available, the heading is plain text.
- **PP Date:** add `Pay_date` (Date) to `Pay_periods`, or update `payDateColumn` to the correct field ID. It is blank by default; it is not guessed from PP Ends.
- **Program:** defaults to `DNR` in `config.js`; an optional `Staff.Program` overrides it.
- **Holidays:** create `Holidays` with a `Date` field and set `tables.holidays` to `'Holidays'`. Alternatively set `holidayDates` to ISO date strings. Holiday shading overrides weekend gray. No holidays are assumed in live data.

## Preview and verification

Run `python3 -m http.server 8000` from the repo root and open `http://localhost:8000/timesheet/?demo=1`. The standalone demo uses fictional data and displays a DEMO label. Inside Grist, demo mode is disabled even if the query parameter is present.

Typical eleven-row output is intended to fit one portrait Letter page. A live Grist connection and its print menu cannot be verified from a standalone preview.

Run the selection checks with `node timesheet/tests/selection.mjs` from the repository root. They exercise stored-reference filtering, leave-only rows, encoded references, summary matching, and print/error handling with a mocked Grist API.
