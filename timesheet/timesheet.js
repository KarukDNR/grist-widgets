/*
 * Karuk Tribe timesheet print widget
 *
 * Reading order:
 *   1. The Grist event handlers at the bottom receive the selected Timesheets row.
 *   2. refresh() reads the configured tables and selects the matching paid hours.
 *   3. totalsFor() finds the corresponding summary calculated by Grist.
 *   4. render() builds the report's HTML; the Print button opens browser printing.
 *
 * This script reads the document only. Payroll calculations stay in Grist.
 * Table/column IDs and assets are configured in config.js. Font sizes, borders,
 * column widths, and print margins are controlled by timesheet.css.
 *
 * JavaScript notation used below:
 *   const declares a binding that is not reassigned; let allows reassignment.
 *   value => expression is a short function (similar to a Python lambda).
 *   array.map(fn) transforms each item; filter(fn) keeps matching items;
 *   find(fn) returns the first match. join('') combines strings without separators.
 *   === compares without converting types; ! means "not".
 *   condition ? yes : no is an inline if/else expression.
 *   Backtick strings can contain HTML, newlines, and ${expressions}.
 *   ... spreads an array/object into another array/object.
 *   ?. stops a property access or call if its receiver is null or undefined.
 *   ?? supplies a fallback only for null/undefined; || also replaces 0, '', false.
 *   async/await waits for work such as table fetching without blocking the page.
 */

// Strict mode helps catch mistakes such as assigning an undeclared variable.
'use strict';
// Define and immediately call a function. Its variables stay local to this widget
// rather than becoming shared globals on window.
(() => {
  // window is the browser's global object. config.js runs first and supplies cfg.
  // Day-column IDs and display labels have the same order: Sunday through Saturday,
  // then Sunday through Saturday again.
  const cfg = window.TIMESHEET_CONFIG;
  const days = ['Sun1','Mon1','Tue1','Wed1','Thu1','Fri1','Sat1','Sun2','Mon2','Tue2','Wed2','Thu2','Fri2','Sat2'];
  const labels = ['SU','M','T','W','TH','F','SA','SU','M','T','W','TH','F','SA'];
  // document represents the HTML page. querySelector('#report') finds the element
  // with id="report"; these elements are defined in index.html.
  const report = document.querySelector('#report');
  const status = document.querySelector('#status');
  const printButton = document.querySelector('#print');
  // State retained between events: selected parent row, latest load number,
  // and whether Grist has granted access to read other tables.
  let selected = null;
  let generation = 0;
  let ready = false;
  // Fictional demo data is available only in a standalone page with ?demo=1.
  // self === top means this page is not inside an iframe, such as a Grist widget.
  const demo = window.self === window.top && new URLSearchParams(location.search).get('demo') === '1';
  // Escape document text before putting it into HTML, so a fund name containing
  // '<' or '&' is displayed as text. The regular expression matches HTML-sensitive
  // characters; replace() substitutes the corresponding HTML entity.
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // fetchTable() returns columns as parallel arrays:
  // {id:[10,11], Fund:[4,5]} becomes [{id:10, Fund:4}, {id:11, Fund:5}].
  // Object.entries() gives [columnName, values] pairs; fromEntries() builds objects.
  // ([key, values]) is "destructuring": assign names to the two items of each pair.
  const rows = table => (table.id || []).map((id, index) => Object.fromEntries(Object.entries(table).map(([key, values]) => [key, values[index]])));
  // References can arrive as a numeric row ID or an encoded ['R', table, id].
  // Normalize both forms to the ID. A Reference List may be ['L', id1, id2, ...];
  // slice(1) removes that marker before normalizing each member.
  const ref = value => Array.isArray(value) && value[0] === 'R' ? value[value.length - 1] : value;
  const ids = value => Array.isArray(value) ? (value[0] === 'L' ? value.slice(1) : value).map(ref) : [];
  // Accept Grist's date encoding, Unix timestamps in seconds, or date strings.
  // JavaScript Date uses milliseconds, so numeric timestamps are multiplied by 1000.
  // A blank date becomes null; a malformed date stops rendering with a useful error.
  function date(value) {
    if (Array.isArray(value) && ['D','d'].includes(value[0])) value = value[1];
    if (value === null || value === undefined || value === '') return null;
    const result = new Date(typeof value === 'number' ? value * 1000 : value);
    if (!Number.isFinite(result.getTime())) throw new Error('Invalid pay-period or holiday date.');
    return result;
  }
  // Calendar comparisons use UTC consistently to avoid browser timezone shifts.
  // iso() gives YYYY-MM-DD for matching holidays; formatDate() gives MM-DD-YY.
  // JavaScript numbers months from 0, hence +1. padStart(2, '0') adds leading zeros.
  const iso = value => value.toISOString().slice(0, 10);
  const formatDate = value => value ? `${String(value.getUTCMonth()+1).padStart(2,'0')}-${String(value.getUTCDate()).padStart(2,'0')}-${String(value.getUTCFullYear()).slice(-2)}` : '';
  // Format a single hours value; this does not sum hours.
  // Detail cells hide zeros by default; callers pass false to display total zeros.
  // Formula errors and text in required numeric cells must be fixed in Grist.
  function hours(value, blankZero = true) {
    if (value === null || value === undefined || value === '') return blankZero ? '' : '0';
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('A required hours/total cell contains an error or non-numeric value. Fix it in Grist before printing.');
    return value === 0 && blankZero ? '' : String(value);
  }
  // Check actual column IDs, not the visible labels a user may rename.
  function requireColumns(table, columns, name) {
    for (const column of columns) if (!(column in table)) throw new Error(`${name} is missing column ${column}. Check config.js and the Grist table.`);
  }
  // Choose exactly one authoritative paid-hours summary for the selected timesheet.
  // Matching priority: stored timesheet reference, exact source-row membership,
  // then employee + period for older summaries lacking both of those fields.
  // Set stores unique paid row IDs and supports fast membership checks.
  // The summary's group field is the list of Hours_paid records it summarizes.
  function totalsFor(table, paid, timesheetId, who, period) {
    const all = rows(table);
    const paidIds = new Set(paid.map(row => row.id));
    const matches = all.filter(row => {
      if (cfg.timesheetColumn in row) return ref(row[cfg.timesheetColumn]) === timesheetId;
      if ('group' in row) {
        const group = ids(row.group);
        return group.length === paidIds.size && group.length > 0 && group.every(id => paidIds.has(id));
      }
      return 'Who' in row && 'Pay_period_end' in row && ref(row.Who) === who && ref(row.Pay_period_end) === period;
    });
    // Missing or ambiguous summaries block printing instead of guessing a total.
    if (matches.length !== 1) throw new Error('Could not identify one paid-hours summary for this timesheet. Group by the timesheet reference or include group, and check tables.totals in config.js.');
    return matches[0];
  }
  // model is an object containing the already-selected records and holiday set.
  // Destructuring below gives each property a local name. This function turns
  // those values into HTML; CSS handles their visual layout.
  function render(model) {
    const {staff, period, paid, funds, totals, holidays} = model;
    const end = date(period.End_date);
    if (!end) throw new Error('The selected pay period has no End_date.');
    const start = date(period.Start_date);
    // The period end is inclusive: subtract 13 days to get the first of 14 days.
    // 86400000 is the number of milliseconds in a day. UTC weekday 6 is Saturday.
    const expected = new Date(end.getTime() - 13 * 86400000);
    if (end.getUTCDay() !== 6 || (start && iso(start) !== iso(expected))) throw new Error('This form requires a 14-day Sunday–Saturday pay period. Check Start_date and End_date.');
    const dates = days.map((_, i) => new Date(expected.getTime() + i * 86400000));
    // Build CSS class names for each day. A holiday takes priority over weekend
    // shading; week-start marks both Sundays. The CSS defines those appearances.
    const classes = dates.map((d, i) => `${holidays.has(iso(d)) ? 'holiday' : [0,6].includes(d.getUTCDay()) ? 'weekend' : ''} ${i === 0 || i === 7 ? 'week-start' : ''}`);
    // These helpers return HTML strings, rather than adding elements immediately.
    // header(true) includes dates for the detail table; header(false) gives the
    // daily-total table only day labels. Month prefixes appear at the start and
    // when the month changes. columns defines the table's shared column widths.
    const header = (withDates = true) => `<thead><tr><th class="heading-label" colspan="2">Day:</th>${labels.map((label,i) => `<th class="${classes[i]}" scope="col">${label}</th>`).join('')}<th ${withDates ? 'rowspan="2"' : ''}>${withDates ? 'Sub-<br>total' : 'Total'}</th></tr>${withDates ? `<tr><th class="heading-label" colspan="2">Date:</th>${dates.map((d,i) => `<th class="date-cell ${classes[i]}">${i === 0 || d.getUTCDate() === 1 ? `${d.getUTCMonth()+1}/` : ''}${d.getUTCDate()}</th>`).join('')}</tr>` : ''}</thead>`;
    const columns = `<colgroup><col class="fund"><col class="type">${days.map(() => '<col class="day">').join('')}<col class="subtotal"></colgroup>`;
    // One Hours_paid record becomes one detail row. row.Fund is a Reference ID,
    // so find() retrieves its name/code from Funds. line(null) makes a blank row.
    // Each daily amount and row total is read as stored/calculated in Grist.
    const line = row => {
      const fund = row ? funds.find(f => f.id === ref(row.Fund)) : null;
      if (row && !fund) throw new Error(`Fund record ${ref(row.Fund)} is missing or inaccessible.`);
      return `<tr class="line"><td class="fund-label">${row ? esc(fund.Name) + '<br><span class="fund-code">' + esc(fund.Code) + '</span>' : ''}</td><td class="hours-type">${row ? esc(row.Hours_type) : ''}</td>${days.map((day,i) => `<td class="number ${classes[i]}">${row ? esc(hours(row[day])) : ''}</td>`).join('')}<td class="number">${row ? esc(hours(row.Total_hours, false)) : ''}</td></tr>`;
    };
    // Add blank rows up to minimumRows; never truncate a longer timesheet.
    const pad = Math.max(0, cfg.minimumRows - paid.length);
    // Validate all totals before exposing a printable report. Never calculate payroll here.
    days.forEach(day => hours(totals[day], false));
    hours(totals.Total, false);
    // Assemble the entire report in one template string. ${...} inserts values or
    // generated markup. map(line).join('') combines all detail rows.
    // Only document text is escaped; intentional HTML tags stay as markup.
    // Total.toFixed(2) displays the daily grand total with two decimal places.
    report.innerHTML = `${demo ? '<p class="demo-note">DEMO — fictional data, not for payroll</p>' : ''}
      <header class="banner"><h1>Karuk Tribe</h1></header>
      <section class="metadata" aria-label="Employee and pay period">
        <b>Name:</b><span class="value name">${esc(staff.Name)}</span><span class="name-space" aria-hidden="true"></span>
        <b>Program:</b><span class="value">${esc(staff.Program || cfg.program)}</span><b>PP Ends:</b><span class="value">${formatDate(end)}</span>
        <b>Position:</b><span class="value">${esc(staff.Title)}</span><b>PP Date:</b><span class="value">${formatDate(date(period[cfg.payDateColumn]))}</span>
      </section>
      <table aria-label="Hours by fund and status">${columns}${header()}<tbody>${paid.map(line).join('')}${Array.from({length:pad}, () => line(null)).join('')}</tbody></table>
      <div class="total-line"><span>Total Hours*</span><strong>${esc(hours(totals.Total, false))}</strong></div>
      <p class="match-note">*Totals boxes should match</p>
      <table class="daily" aria-label="Daily totals">${columns}${header(false)}<tbody><tr><th colspan="2" class="daily-label" scope="row">DAILY Totals*</th>${days.map((day,i) => `<td class="number ${classes[i]}">${esc(hours(totals[day], false))}</td>`).join('')}<td class="number grand-total">${totals.Total.toFixed(2)}</td></tr></tbody></table>
      <p class="legend">Shaded days represent weekends and holidays.</p>
      <p class="certification">THE UNDERSIGNED CERTIFY THAT THE ABOVE INFORMATION IS TRUE</p>
      <p class="supervisor-note">(Supervisor's Signature Must Be Present Prior To Submission To Payroll)</p>
      <section class="signatures" aria-label="Signatures"><span>Employee:</span><span class="signature-line"></span><span>Date:</span><span class="signature-line"></span><span>Supervisor:</span><span class="signature-line"></span><span>Date:</span><span class="signature-line"></span></section>
      <p class="deadline">Time sheets are due by <strong>5:00 PM on the Monday following the close of the pay period.</strong></p>`;
    // Load the letterhead asynchronously. Keep the text heading until it loads.
    // onload is a callback invoked when the image becomes available. The optional
    // call ?. avoids an error if the report was cleared before the image loaded.
    if (cfg.banner) {
      const banner = new Image();
      banner.alt = 'Karuk Tribe letterhead';
      banner.onload = () => report.querySelector('.banner')?.replaceChildren(banner);
      banner.src = cfg.banner;
    }
    // Expose the completed report and enable printing only after validation.
    report.hidden = false;
    printButton.disabled = false;
    status.textContent = `${staff.Name} · Period ending ${formatDate(end)}${demo ? ' · DEMO' : ''}`;
  }
  // Hide stale/invalid output, disable printing, and show the explanation.
  function clear(message) { report.hidden = true; report.replaceChildren(); printButton.disabled = true; status.textContent = message; }
  // Main data-loading function. Called when selection/access changes or Refresh
  // is clicked. Errors are shown in the toolbar instead of leaving an old report.
  async function refresh() {
    // Every load gets a sequence number. If selection changes while fetching,
    // a newer load increments generation; the older response is then ignored.
    const version = ++generation;
    clear('Loading timesheet…');
    if (!selected || !selected.id || !ref(selected.Who) || !ref(selected.Pay_period_end)) { clear('Select a Timesheets row with an employee and pay period.'); return; }
    if (!ready) { clear('Grant Full document access in the custom widget settings, then click Refresh.'); return; }
    // The selected record must come from the Timesheets table itself.
    // Its id identifies the parent; Who and Pay_period_end identify metadata rows.
    const timesheetId = selected.id, who = ref(selected.Who), periodId = ref(selected.Pay_period_end);
    // try/catch handles rejected API requests and our own validation errors.
    try {
      // Read the independent tables concurrently. Promise.all waits for all reads;
      // key order connects each result to its name in the tables object.
      // A nonexistent configured table ID causes an API error here.
      const keys = ['hours','totals','staff','funds','periods'];
      if (cfg.tables.holidays) keys.push('holidays');
      const fetched = await Promise.all(keys.map(key => grist.docApi.fetchTable(cfg.tables[key])));
      if (version !== generation) return;
      const tables = Object.fromEntries(keys.map((key,i) => [key, fetched[i]]));
      requireColumns(tables.hours, [cfg.timesheetColumn,'Fund','Hours_type','Total_hours',...days], cfg.tables.hours);
      requireColumns(tables.totals, ['Total',...days], cfg.tables.totals);
      // Select by the stored parent reference, not a concatenated text key.
      // Thus a leave-only timesheet works without any task Hours records.
      // Paid-table Who/period formulas are not needed for this selection.
      const paid = rows(tables.hours).filter(r => ref(r[cfg.timesheetColumn]) === timesheetId);
      if (!paid.length) throw new Error('No paid-hour rows exist for the selected timesheet.');
      const staff = rows(tables.staff).find(r => r.id === who);
      const period = rows(tables.periods).find(r => r.id === periodId);
      if (!staff || !period) throw new Error('Employee or pay period is missing or inaccessible.');
      // Set combines configured ISO holiday dates with the optional Holidays table,
      // automatically removing duplicates.
      const holidays = new Set(cfg.holidayDates);
      if (tables.holidays) {
        requireColumns(tables.holidays, ['Date'], cfg.tables.holidays);
        rows(tables.holidays).forEach(row => { const d = date(row.Date); if (d) holidays.add(iso(d)); });
      }
      render({staff,period,paid,funds:rows(tables.funds),totals:totalsFor(tables.totals,paid,timesheetId,who,periodId),holidays});
    } catch (error) { if (version === generation) clear(error.message); }
  }
  // Register a click callback; registration does not run it yet. Before opening
  // browser printing, wait for fonts and the report images to finish decoding.
  // An image decode failure is ignored so the print dialog can still open.
  // PDF creation is handled by the browser's Print / Save PDF dialog.
  printButton.addEventListener('click', async () => {
    if (printButton.disabled) return;
    await document.fonts.ready;
    await Promise.all(Array.from(report.querySelectorAll('img')).map(img => img.decode().catch(() => {})));
    window.print();
  });
  // Refresh rerenders fictional data in demo mode or reloads live Grist data.
  document.querySelector('#refresh').addEventListener('click', () => demo ? renderDemo() : refresh());
  // Construct fictional records in the same shape as a live model. Only the demo
  // assembles sample totals here; live totals always come from Grist's summary.
  function renderDemo() {
    const workedDays = [[1,2],[3,4],[8,9],[10,12],[11],[5]];
    const paid = Array.from({length:6}, (_,i) => ({id:i+1,Fund:i+1,Hours_type:i===5?'Holiday':'Regular',Total_hours:[16,16,16,16,8,8][i],...Object.fromEntries(days.map((d,j) => [d,workedDays[i].includes(j) ? 8 : 0]))}));
    render({staff:{Name:'Example Employee',Title:'GIS Specialist'},period:{Start_date:'2026-09-20',End_date:'2026-10-03'},paid,funds:paid.map((r,i)=>({id:r.Fund,Name:`Example Fund ${i+1}`,Code:`0000-00-000${i+1}.00`})),totals:{Total:80,...Object.fromEntries(days.map((d,j)=>[d,[0,6,7,13].includes(j)?0:8]))},holidays:new Set(['2026-09-25'])});
  }
  // Startup branches: standalone demo, missing Grist API, or live Grist connection.
  if (demo) { renderDemo(); return; }
  if (!window.grist) { clear('Grist API could not load. Open this URL in a Grist custom widget, or use ?demo=1 for a standalone preview.'); return; }
  // Grist invokes these callbacks as events occur:
  // onOptions reports the granted access level; full access enables cross-table reads.
  // onRecord supplies the selected Timesheets row; save it and refresh.
  // onRecords triggers another refresh when the widget's record set updates.
  // keepEncoded/expandRefs:false preserve Reference IDs instead of display text.
  // ready() requests access and announces that the widget is ready to receive events.
  grist.onOptions((options, interaction) => { ready = interaction?.accessLevel === 'full'; refresh(); });
  grist.onRecord(record => { selected = record; refresh(); }, {keepEncoded:true, expandRefs:false});
  grist.onRecords(() => refresh(), {keepEncoded:true, expandRefs:false});
  grist.ready({requiredAccess:'full'});
})();
