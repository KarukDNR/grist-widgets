/*
 * Karuk Tribe timesheet print widget
 *
 * Reading order:
 *   1. The Grist event handlers at the bottom receive the selected Timesheets row.
 *   2. refresh() reads Hours_paid once and selects the IDs in Timesheet_lines.
 *   3. render() formats Grist's prepared values; Print opens browser printing.
 *
 * This script reads the document only. Payroll calculations stay in Grist.
 * The Hours_paid table name and assets are configured in config.js. Font sizes, borders,
 * column widths, and print margins are controlled by timesheet.css.
 *
 * JavaScript notation used below:
 *   const declares a binding that is not reassigned; let allows reassignment.
 *   value => expression is a short function (similar to a Python lambda).
 *   array.map(fn) transforms each item; filter(fn) keeps matching items;
 *   join('') combines strings without separators.
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
  // Grist may encode references as ['R', table, id] and lists as ['L', ...].
  const ref = value => Array.isArray(value) && value[0] === 'R' ? value[value.length - 1] : value;
  const list = value => Array.isArray(value) ? (value[0] === 'L' ? value.slice(1) : value) : [];
  const ids = value => list(value).map(ref);
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
    for (const column of columns) if (!(column in table)) throw new Error(`${name} is missing column ${column}. Check the Grist table and selected columns.`);
  }
  // model is an object containing the already-selected records and holiday set.
  // Destructuring below gives each property a local name. This function turns
  // those values into HTML; CSS handles their visual layout.
  function render(model) {
    const {timesheet, paid, holidays} = model;
    const totals = timesheet;
    const program = timesheet.Who_Program || cfg.program;
    const end = date(timesheet.Pay_period_End_date);
    if (!end) throw new Error('The selected pay period has no End_date.');
    const start = date(timesheet.Pay_period_Start_date);
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
    const header = (withDates = true) => `<thead><tr><th class="heading-label">Day:</th>${labels.map((label,i) => `<th class="${classes[i]}" scope="col">${label}</th>`).join('')}<th ${withDates ? 'rowspan="2"' : ''}>${withDates ? 'Sub-<br>total' : 'Total'}</th></tr>${withDates ? `<tr><th class="heading-label">Date:</th>${dates.map((d,i) => `<th class="date-cell ${classes[i]}">${i === 0 || d.getUTCDate() === 1 ? `${d.getUTCMonth()+1}/` : ''}${d.getUTCDate()}</th>`).join('')}</tr>` : ''}</thead>`;
    const columns = `<colgroup><col class="fund">${days.map(() => '<col class="day">').join('')}<col class="subtotal"></colgroup>`;
    // One Hours_paid record becomes one detail row. line(null) makes a blank row.
    // Each daily amount and row total is read as stored/calculated in Grist.
    const line = row => {
      const fundLabel = row?.Fund_Name ? `${esc(row.Fund_Name)}<br><span class="fund-code">${esc(row.Fund_Code)}</span>` : '';
      const type = String(row?.Hours_type ?? '').trim();
      const prefix = type && type.toLowerCase() !== 'regular' ? `<span class="hours-type">${esc(type.toUpperCase())}</span> ` : '';
      return `<tr class="line"><td class="fund-label">${prefix + fundLabel}</td>${days.map((day,i) => `<td class="number ${classes[i]}">${row ? esc(hours(row[day])) : ''}</td>`).join('')}<td class="number">${row ? esc(hours(row.Total_hours, false)) : ''}</td></tr>`;
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
        <b>Name:</b><span class="value name">${esc(timesheet.Who_Legal_name)}</span><span class="name-space" aria-hidden="true"></span>
        <b>Program:</b><span class="value">${esc(program)}</span><b>PP Ends:</b><span class="value">${formatDate(end)}</span>
        <b>Position:</b><span class="value">${esc(timesheet.Who_Title)}</span><b>PP Date:</b><span class="value">${formatDate(date(timesheet.Pay_period_Pay_date))}</span>
      </section>
      <table aria-label="Hours by fund and status">${columns}${header()}<tbody>${paid.map(line).join('')}${Array.from({length:pad}, () => line(null)).join('')}</tbody></table>
      <div class="total-line"><span>Total Hours*</span><strong>${esc(hours(totals.Total, false))}</strong></div>
      <p class="match-note">*Totals boxes should match</p>
      <table class="daily" aria-label="Daily totals">${columns}${header(false)}<tbody><tr><th class="daily-label" scope="row">DAILY Totals*</th>${days.map((day,i) => `<td class="number ${classes[i]}">${esc(hours(totals[day], false))}</td>`).join('')}<td class="number grand-total">${totals.Total.toFixed(2)}</td></tr></tbody></table>
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
    status.textContent = `${timesheet.Who_Legal_name} · Period ending ${formatDate(end)}${demo ? ' · DEMO' : ''}`;
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
    if (!selected || !selected.id || !ref(selected.Who) || !ref(selected.Pay_period)) { clear('Select a Timesheets row with an employee and pay period.'); return; }
    if (!ready) { clear('Grant Full document access in the custom widget settings, then click Refresh.'); return; }
    // try/catch handles rejected API requests and our own validation errors.
    try {
      requireColumns(selected, ['Timesheet_lines','Who_Legal_name','Who_Title','Who_Program','Pay_period_Start_date','Pay_period_End_date','Pay_period_Pay_date','Holiday_Dates','Total',...days], 'Timesheets');
      const lineIds = new Set(ids(selected.Timesheet_lines));
      if (!lineIds.size) throw new Error('No paid-hour rows exist for the selected timesheet.');
      const hoursTable = await grist.docApi.fetchTable(cfg.tables.hours);
      if (version !== generation) return;
      requireColumns(hoursTable, ['Fund_Name','Fund_Code','Hours_type','Total_hours',...days], cfg.tables.hours);
      const paid = rows(hoursTable).filter(row => lineIds.has(row.id));
      if (paid.length !== lineIds.size) throw new Error('Some paid-hour rows in Timesheet_lines are missing or inaccessible.');
      const holidayDates = [...cfg.holidayDates, ...list(selected.Holiday_Dates)];
      const holidays = new Set(holidayDates.map(date).filter(Boolean).map(iso));
      render({timesheet:selected,paid,holidays});
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
  // Construct fictional records in the same shape as the Grist-prepared values.
  function renderDemo() {
    const workedDays = [[1,2],[3,4],[8,9],[10,12],[11],[5]];
    const paid = Array.from({length:6}, (_,i) => ({id:i+1,Fund_Name:`Example Fund ${i+1}`,Fund_Code:`0000-00-000${i+1}.00`,Hours_type:i===5?'Holiday':'Regular',Total_hours:[16,16,16,16,8,8][i],...Object.fromEntries(days.map((d,j) => [d,workedDays[i].includes(j) ? 8 : 0]))}));
    const timesheet = {Who_Legal_name:'Example Employee',Who_Title:'GIS Specialist',Who_Program:cfg.program,Pay_period_Start_date:'2026-09-20',Pay_period_End_date:'2026-10-03',Pay_period_Pay_date:null,Total:80,...Object.fromEntries(days.map((d,j)=>[d,[0,6,7,13].includes(j)?0:8]))};
    render({timesheet,paid,holidays:new Set(['2026-09-25'])});
  }
  // Startup branches: standalone demo, missing Grist API, or live Grist connection.
  if (demo) { renderDemo(); return; }
  if (!window.grist) { clear('Grist API could not load. Open this URL in a Grist custom widget, or use ?demo=1 for a standalone preview.'); return; }
  // Grist invokes these callbacks as events occur:
  // onOptions reports the granted access level; full access enables cross-table reads.
  // onRecord supplies the selected Timesheets row; save it and refresh.
  // Include ordinary columns even when the widget section shows only a few.
  // keepEncoded/expandRefs:false preserve Reference and Reference List IDs.
  // ready() requests access and announces that the widget is ready to receive events.
  grist.onOptions((options, interaction) => { ready = interaction?.accessLevel === 'full'; refresh(); });
  grist.onRecord(record => { selected = record; refresh(); }, {keepEncoded:true, expandRefs:false, includeColumns:'normal'});
  grist.ready({requiredAccess:'full'});
})();
