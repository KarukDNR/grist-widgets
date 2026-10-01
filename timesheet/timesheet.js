'use strict';
(() => {
  const cfg = window.TIMESHEET_CONFIG;
  const days = ['Sun1','Mon1','Tue1','Wed1','Thu1','Fri1','Sat1','Sun2','Mon2','Tue2','Wed2','Thu2','Fri2','Sat2'];
  const labels = ['SU','M','T','W','TH','F','SA','SU','M','T','W','TH','F','SA'];
  const report = document.querySelector('#report');
  const status = document.querySelector('#status');
  const printButton = document.querySelector('#print');
  let selected = null;
  let generation = 0;
  let ready = false;
  const demo = window.self === window.top && new URLSearchParams(location.search).get('demo') === '1';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const rows = table => (table.id || []).map((id, index) => Object.fromEntries(Object.entries(table).map(([key, values]) => [key, values[index]])));
  const ref = value => Array.isArray(value) && value[0] === 'R' ? value[value.length - 1] : value;
  const ids = value => Array.isArray(value) ? (value[0] === 'L' ? value.slice(1) : value).map(ref) : [];
  function date(value) {
    if (Array.isArray(value) && ['D','d'].includes(value[0])) value = value[1];
    if (value === null || value === undefined || value === '') return null;
    const result = new Date(typeof value === 'number' ? value * 1000 : value);
    if (!Number.isFinite(result.getTime())) throw new Error('Invalid pay-period or holiday date.');
    return result;
  }
  const iso = value => value.toISOString().slice(0, 10);
  const formatDate = value => value ? `${String(value.getUTCMonth()+1).padStart(2,'0')}-${String(value.getUTCDate()).padStart(2,'0')}-${String(value.getUTCFullYear()).slice(-2)}` : '';
  function hours(value, blankZero = true) {
    if (value === null || value === undefined || value === '') return blankZero ? '' : '0';
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('A required hours/total cell contains an error or non-numeric value. Fix it in Grist before printing.');
    return value === 0 && blankZero ? '' : String(value);
  }
  function requireColumns(table, columns, name) {
    for (const column of columns) if (!(column in table)) throw new Error(`${name} is missing column ${column}. Check config.js and the Grist table.`);
  }
  function totalsFor(table, paid, who, period) {
    const all = rows(table);
    const paidIds = new Set(paid.map(row => row.id));
    const matches = all.filter(row => {
      if ('Who' in row && 'Pay_period_end' in row) return ref(row.Who) === who && ref(row.Pay_period_end) === period;
      const group = ids(row.group);
      return group.length === paidIds.size && group.length > 0 && group.every(id => paidIds.has(id));
    });
    if (matches.length !== 1) throw new Error('Could not identify one paid-hours summary for this employee/period. Include group in the summary, or group by Who and Pay_period_end.');
    return matches[0];
  }
  function render(model) {
    const {staff, period, paid, funds, totals, holidays} = model;
    const end = date(period.End_date);
    if (!end) throw new Error('The selected pay period has no End_date.');
    const start = date(period.Start_date);
    const expected = new Date(end.getTime() - 13 * 86400000);
    if (end.getUTCDay() !== 6 || (start && iso(start) !== iso(expected))) throw new Error('This form requires a 14-day Sunday–Saturday pay period. Check Start_date and End_date.');
    const dates = days.map((_, i) => new Date(expected.getTime() + i * 86400000));
    const classes = dates.map((d, i) => `${holidays.has(iso(d)) ? 'holiday' : [0,6].includes(d.getUTCDay()) ? 'weekend' : ''} ${i === 0 || i === 7 ? 'week-start' : ''}`);
    const header = (withDates = true) => `<thead><tr><th class="heading-label" colspan="2">Day:</th>${labels.map((label,i) => `<th class="${classes[i]}" scope="col">${label}</th>`).join('')}<th ${withDates ? 'rowspan="2"' : ''}>SUB-<br>TOTAL</th></tr>${withDates ? `<tr><th class="heading-label" colspan="2">Date:</th>${dates.map((d,i) => `<th class="${classes[i]}">${i === 0 || d.getUTCDate() === 1 ? `${d.getUTCMonth()+1}/` : ''}${d.getUTCDate()}</th>`).join('')}</tr>` : ''}</thead>`;
    const columns = `<colgroup><col class="fund"><col class="type">${days.map(() => '<col class="day">').join('')}<col class="subtotal"></colgroup>`;
    const line = row => {
      const fund = row ? funds.find(f => f.id === ref(row.Fund)) : null;
      if (row && !fund) throw new Error(`Fund record ${ref(row.Fund)} is missing or inaccessible.`);
      return `<tr class="line"><td class="fund-label">${row ? esc(fund.Name) + '<br>' + esc(fund.Code) : ''}</td><td class="hours-type">${row ? esc(row.Hours_type) : ''}</td>${days.map((day,i) => `<td class="number ${classes[i]}">${row ? esc(hours(row[day])) : ''}</td>`).join('')}<td class="number">${row ? esc(hours(row.Total_hours, false)) : '0'}</td></tr>`;
    };
    const pad = Math.max(0, cfg.minimumRows - paid.length);
    // Validate all totals before exposing a printable report. Never calculate payroll here.
    days.forEach(day => hours(totals[day], false));
    hours(totals.Total, false);
    report.innerHTML = `${demo ? '<p class="demo-note">DEMO — fictional data, not for payroll</p>' : ''}
      <header class="banner"><h1>Karuk Tribe</h1></header>
      <section class="metadata" aria-label="Employee and pay period">
        <b>Name:</b><span class="value wide">${esc(staff.Name)}</span>
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
    if (cfg.banner) {
      const banner = new Image();
      banner.alt = 'Karuk Tribe letterhead';
      banner.onload = () => report.querySelector('.banner')?.replaceChildren(banner);
      banner.src = cfg.banner;
    }
    report.hidden = false;
    printButton.disabled = false;
    status.textContent = `${staff.Name} · Period ending ${formatDate(end)}${demo ? ' · DEMO' : ''}`;
  }
  function clear(message) { report.hidden = true; report.replaceChildren(); printButton.disabled = true; status.textContent = message; }
  async function refresh() {
    const version = ++generation;
    clear('Loading timesheet…');
    if (!selected || !ref(selected.Who) || !ref(selected.Pay_period_end)) { clear('Select one employee/pay-period row from Hours [by Who, Pay_period_end].'); return; }
    if (!ready) { clear('Grant Full document access in the custom widget settings, then click Refresh.'); return; }
    const who = ref(selected.Who), periodId = ref(selected.Pay_period_end);
    try {
      const keys = ['hours','totals','staff','funds','periods'];
      if (cfg.tables.holidays) keys.push('holidays');
      const fetched = await Promise.all(keys.map(key => grist.docApi.fetchTable(cfg.tables[key])));
      if (version !== generation) return;
      const tables = Object.fromEntries(keys.map((key,i) => [key, fetched[i]]));
      requireColumns(tables.hours, ['Who','Pay_period_end','Fund','Hours_type','Total_hours',...days], cfg.tables.hours);
      requireColumns(tables.totals, ['Total',...days], cfg.tables.totals);
      const paid = rows(tables.hours).filter(r => ref(r.Who) === who && ref(r.Pay_period_end) === periodId);
      if (!paid.length) throw new Error('No paid-hour rows exist for this employee/pay period.');
      const staff = rows(tables.staff).find(r => r.id === who);
      const period = rows(tables.periods).find(r => r.id === periodId);
      if (!staff || !period) throw new Error('Employee or pay period is missing or inaccessible.');
      const holidays = new Set(cfg.holidayDates);
      if (tables.holidays) {
        requireColumns(tables.holidays, ['Date'], cfg.tables.holidays);
        rows(tables.holidays).forEach(row => { const d = date(row.Date); if (d) holidays.add(iso(d)); });
      }
      render({staff,period,paid,funds:rows(tables.funds),totals:totalsFor(tables.totals,paid,who,periodId),holidays});
    } catch (error) { if (version === generation) clear(error.message); }
  }
  printButton.addEventListener('click', async () => {
    if (printButton.disabled) return;
    await document.fonts.ready;
    await Promise.all(Array.from(report.images).map(img => img.decode().catch(() => {})));
    window.print();
  });
  document.querySelector('#refresh').addEventListener('click', () => demo ? renderDemo() : refresh());
  function renderDemo() {
    const workedDays = [[1,2],[3,4],[8,9],[10,12],[11],[5]];
    const paid = Array.from({length:6}, (_,i) => ({id:i+1,Fund:i+1,Hours_type:i===5?'Holiday':'Regular',Total_hours:[16,16,16,16,8,8][i],...Object.fromEntries(days.map((d,j) => [d,workedDays[i].includes(j) ? 8 : 0]))}));
    render({staff:{Name:'Example Employee',Title:'GIS Specialist'},period:{Start_date:'2026-09-20',End_date:'2026-10-03'},paid,funds:paid.map((r,i)=>({id:r.Fund,Name:`Example Fund ${i+1}`,Code:`0000-00-000${i+1}.00`})),totals:{Total:80,...Object.fromEntries(days.map((d,j)=>[d,[0,6,7,13].includes(j)?0:8]))},holidays:new Set(['2026-09-25'])});
  }
  if (demo) { renderDemo(); return; }
  if (!window.grist) { clear('Grist API could not load. Open this URL in a Grist custom widget, or use ?demo=1 for a standalone preview.'); return; }
  grist.onOptions((options, interaction) => { ready = interaction?.accessLevel === 'full'; refresh(); });
  grist.onRecord(record => { selected = record; refresh(); }, {keepEncoded:true, expandRefs:false});
  grist.onRecords(() => refresh(), {keepEncoded:true, expandRefs:false});
  grist.ready({requiredAccess:'full'});
})();
