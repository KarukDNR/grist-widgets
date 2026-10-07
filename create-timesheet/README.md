# Load timesheet

Select an employee and pay period, then click **Load timesheet**. The widget
checks fresh Timesheets data, creates the parent if needed, and selects it.
Its message distinguishes a new timesheet from an existing one. It replaces
the native Timesheets selector; no existing row is needed to get started.

The employee defaults to the unique active Staff.Name matching the signed-in
user.Name. Staff whose Status is retired are excluded (ignoring case and outer
spaces), including from the default match. Other active employees remain
available for manual selection. The pay period defaults to the unique period
whose Start_date/End_date include today in America/Los_Angeles. Historical
periods remain available. Missing or overlapping current periods require a choice.

## Signed-in employee setup

Grist exposes user.Name to trigger formulas, not directly to custom-widget
JavaScript. Add this small helper table once:

1. Create a table with table ID **Widget_user**.
2. Add a **Text** data column with column ID **Name**.
3. Set Name's **trigger formula** to `user.Name`, applying **only to new records**.
   This must be a trigger on a data column, not a regular formula column.
4. Allow widget users to create/read/delete helper records and read the Name
   trigger result.

The widget adds an empty helper row, reads the name Grist supplies, and removes
that specific row in a finally block. It never creates a temporary Timesheets
record to identify the employee. A failed cleanup reports the helper row ID;
that leftover row can be deleted manually. Names must match Staff.Name exactly.
No match, duplicate active names, or missing helper permissions leave employee
selection manual and show a message. Identity is kept only in this iframe's
memory, never in shared widget options.

## Install and replace the native selector

1. Merge and deploy this repository from main/root.
2. Add a Custom widget to the timesheet page, using **Timesheets** as its data
   table, without grouping or filters. Name it **Load timesheet**.
3. Set its URL to `https://karukdnr.github.io/grist-widgets/create-timesheet/`.
   The existing URL is retained so installed copies update.
4. Grant **Full document access**. The user also needs permission to read
   Staff/Pay_periods/Timesheets and create Timesheets records.
5. Leave this widget's **Select By** empty; it has its own selectors.
6. Change the **Hours_paid** table's **Select By** to
   **Load timesheet → Timesheets**, using its editable Timesheets reference.
   New paid-hours rows inherit that selected parent; Who and Pay_period_end
   can remain formulas derived from it.
7. Set the print widget (also using Timesheets) to **Select By → Load timesheet**.
   Repoint other linked summaries to this source using their Timesheets
   reference/grouping field where applicable.
8. Remove the old native Timesheets selector after checking the new links, and
   resize Load timesheet to a short panel.

Click Load timesheet after choosing employee/period. Changing a choice clears
the linked row selection until the next load, so paid-hours tables are not
left showing the previous selection. Loading selects the row through both
Grist's selected-row filter and cursor APIs: detail tables receive the parent
reference and same-table links receive the selected record.

Do not put the old last-two-weeks filter on this selector or linked print
widget: it would hide historical timesheets selected here. Refresh updates
the employee and pay-period lists and clears the loaded selection. It preserves
valid manual choices; retired employees disappear on refresh. Status is checked
again on each Load click.

## Custom Widget Builder alternative

1. Use Timesheets as the data table and grant Full document access.
2. Paste index.html into the HTML tab, removing its config.js and widget.js
   script tags at the bottom. Keep the plugin API script and inline style.
3. Paste config.js followed by widget.js into the JavaScript tab.
4. Click Preview, save, and configure the same outgoing Select By links.

Builder copies must be updated manually when repository code changes.

## Configuration and limitations

config.js contains table/column IDs and timezone. Defaults:
Staff.Name/Status; Pay_periods.Start_date/End_date;
Timesheets.Who/Pay_period_end; Widget_user.Name.

The button writes only Who and Pay_period_end on a new Timesheets row.
It never changes paid hours. Native Timesheets entry may still use the Who
creation-only trigger `value or Staff.lookupOne(Name=user.Name)` to preserve
the employee explicitly supplied by this widget.

Reference fields are row IDs. Grist's triggers and access rules still apply.
Retired staff filtering improves the interface; use access rules to restrict
which employees a user may edit if that is required.

The duplicate check prevents repeat clicks but is not an atomic uniqueness
constraint: simultaneous users may both create a row. Ambiguous existing
duplicates are reported without selecting one. A selection failure after
creation explicitly reports that the row was created; clicking Load again
finds that existing row.

No document IDs, credentials, or payroll data are stored in this repository.

## Validation

Run `node create-timesheet/tests/create.mjs` from the repository root.
Tests mock identity triggers, helper cleanup, retirement filtering, timezone,
creation/reuse, linked selection, duplicate detection, and API errors.
Live iframe access rules and Select By wiring must be checked in the document.
