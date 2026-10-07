# Create timesheet

Creates a Timesheets parent row on demand for a selected employee and pay period.
Employee selection is independent of the existing Timesheets list, so users can
create their first timesheet even when that list is empty.

The pay-period selector defaults to the unique period whose Start_date/End_date
include today, using America/Los_Angeles. Other periods remain available for
late entry. Missing or overlapping current periods require an explicit choice.
The button checks fresh Timesheets data before writing and reports an existing
timesheet instead of adding another. It writes only Who and Pay_period_end to a
new parent row; it never changes paid hours.

## Install with GitHub Pages

1. Merge and deploy this repository from main/root.
2. Add a Custom widget to the timesheet entry page, using the **Timesheets** data table without grouping.
3. Set its URL to `https://karukdnr.github.io/grist-widgets/create-timesheet/`.
4. No Select By setting or column mappings are required: the widget has its own employee and period selectors.
5. Grant **Full document access**. The user must also have permission to read Staff/Pay_periods/Timesheets and create Timesheets records.
6. Resize it to a short panel above the Timesheets list.

Choose an employee, confirm the period, then click Create timesheet.
Select the resulting row in the native Timesheets list to populate Hours_paid.
Keep that list sorted by pay-period end descending. Its filters must include
the chosen period; a historical period may be hidden by your recent-period filter.
The button does not navigate another widget's cursor or override its filters.

Use Refresh after changing staff or pay-period data. Employee choice in the button is explicit. For native Timesheets row entry,
Who can use the creation-only trigger formula `Staff.lookupOne(Name=user.Name)`.
This matches the signed-in user's name exactly. The custom-widget API does not
directly expose that trigger-formula user object, so this widget retains an
employee selector to check duplicates before creating a row. An explicitly
supplied Who value should be preserved by any default trigger you configure
(for example, `value or Staff.lookupOne(Name=user.Name)`).

## Custom Widget Builder alternative

The same code can be kept in the document through Custom Widget Builder:

1. Use Timesheets as its data table and grant Full document access.
2. Paste index.html into the HTML tab, **removing its config.js and widget.js script tags** at the bottom. Keep the Grist plugin API script and the inline style.
3. Paste the contents of config.js followed by widget.js into the JavaScript tab.
4. Click Preview and save the widget configuration.

The hosted version is easier to update through PRs; Builder copies must be
updated manually when the repository code changes.

## Configuration and limitations

config.js contains actual table/column IDs and the timezone. Defaults:
Staff.Name; Pay_periods.Start_date/End_date; Timesheets.Who/Pay_period_end.

Reference fields are written as row IDs. Grist's trigger formulas, access rules,
and other document behavior still apply to creation. No document ID, credentials,
or payroll data are stored in this repository.

The duplicate check prevents ordinary repeat clicks, but it is **not an atomic
uniqueness constraint**: two users can check at the same time and both create a row.
Use a Grist duplicate-prevention access rule if concurrent creation must be enforced.

## Validation

Run `node create-timesheet/tests/create.mjs` from the repository root.
Tests mock the Grist API; live iframe permissions and native list filters require
verification in the document.
