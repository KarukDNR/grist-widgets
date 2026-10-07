'use strict';
(() => {
  // The selectors live inside this widget, so creation works even when the
  // native Timesheets list has no rows. No existing timesheet selection is needed.
  const cfg = window.CREATE_TIMESHEET_CONFIG;
  const employee = document.querySelector('#employee');
  const period = document.querySelector('#period');
  const create = document.querySelector('#create');
  const refresh = document.querySelector('#refresh');
  const status = document.querySelector('#status');
  let access = false, busy = false, loaded = false, generation = 0;
  let staff = [], periods = [];
  const rows = table => (table.id || []).map((id, i) =>
    Object.fromEntries(Object.entries(table).map(([key, values]) => [key, values[i]])));
  const ref = value => Array.isArray(value) && value[0] === 'R' ? value[value.length - 1] : value;
  function day(value) {
    if (Array.isArray(value) && ['D','d'].includes(value[0])) value = value[1];
    if (value === null || value === undefined || value === '') return null;
    const date = new Date(typeof value === 'number' ? value * 1000 : value);
    return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
  }
  function today() {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: cfg.timezone, year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const get = type => parts.find(part => part.type === type).value;
    return get('year') + '-' + get('month') + '-' + get('day');
  }
  function requireColumns(table, columns, name) {
    for (const column of columns) {
      if (!(column in table)) throw new Error(name + ' is missing column ' + column + '. Check config.js.');
    }
  }
  function updateControls() {
    employee.disabled = period.disabled = !access || busy || !loaded;
    refresh.disabled = !access || busy;
    create.disabled = !access || busy || !loaded || !employee.value || !period.value;
  }
  function options(select, records, label, previous, fallback = '') {
    select.replaceChildren(new Option('Select…', ''));
    for (const row of records) select.add(new Option(label(row), String(row.id)));
    select.value = records.some(row => String(row.id) === previous) ? previous : fallback;
  }
  async function load() {
    if (busy) return;
    const version = ++generation;
    loaded = false;
    updateControls();
    if (!access) { status.textContent = 'Grant Full document access to create timesheets.'; return; }
    status.textContent = 'Loading employees and pay periods…';
    try {
      const [people, payPeriods] = await Promise.all([
        grist.docApi.fetchTable(cfg.tables.staff), grist.docApi.fetchTable(cfg.tables.periods)
      ]);
      if (version !== generation || !access) return;
      requireColumns(people, [cfg.columns.staffName], cfg.tables.staff);
      requireColumns(payPeriods, [cfg.columns.start, cfg.columns.end], cfg.tables.periods);
      staff = rows(people).sort((a, b) => String(a[cfg.columns.staffName] || '').localeCompare(String(b[cfg.columns.staffName] || '')));
      periods = rows(payPeriods).filter(row => {
        const start = day(row[cfg.columns.start]), end = day(row[cfg.columns.end]);
        return start && end && start <= end;
      }).sort((a, b) => day(b[cfg.columns.end]).localeCompare(day(a[cfg.columns.end])));
      const current = periods.filter(row => day(row[cfg.columns.start]) <= today() && today() <= day(row[cfg.columns.end]));
      options(employee, staff, row => row[cfg.columns.staffName] || '(Unnamed employee)', employee.value);
      options(period, periods, row => 'Ending ' + day(row[cfg.columns.end]), period.value,
        current.length === 1 ? String(current[0].id) : '');
      loaded = true;
      status.textContent = current.length === 1 ? 'Choose an employee, then create their timesheet.' :
        'Choose an employee and pay period. No single pay period contains today.';
    } catch (error) {
      if (version === generation) status.textContent = error.message;
    }
    updateControls();
  }
  employee.addEventListener('change', updateControls);
  period.addEventListener('change', updateControls);
  refresh.addEventListener('click', load);
  create.addEventListener('click', async () => {
    if (create.disabled || busy) return;
    // Capture the intended values before awaiting the API; disable controls to
    // prevent double clicks or changing employee/period during this operation.
    const who = Number(employee.value), payPeriod = Number(period.value);
    busy = true;
    updateControls();
    status.textContent = 'Checking for an existing timesheet…';
    try {
      // Fetch fresh data on every click, rather than trusting a cached list.
      const table = await grist.docApi.fetchTable(cfg.tables.timesheets);
      if (!access) throw new Error('Full document access is required.');
      requireColumns(table, [cfg.columns.who, cfg.columns.period], cfg.tables.timesheets);
      const existing = rows(table).filter(row =>
        ref(row[cfg.columns.who]) === who && ref(row[cfg.columns.period]) === payPeriod);
      if (existing.length > 1) {
        status.textContent = 'Multiple timesheets already exist for this employee and period. Review them before continuing.';
      } else if (existing.length === 1) {
        status.textContent = 'Timesheet already exists. Select it in the Timesheets list to enter paid hours.';
      } else {
        // Add only the parent row. Grist applies its own default/trigger formulas;
        // no Hours_paid records are created or modified by this button.
        await grist.docApi.applyUserActions([['AddRecord', cfg.tables.timesheets, null, {
          [cfg.columns.who]: who, [cfg.columns.period]: payPeriod
        }]]);
        status.textContent = 'Timesheet created. Select it in the Timesheets list to enter paid hours.';
      }
    } catch (error) {
      status.textContent = 'Could not create timesheet: ' + error.message;
    } finally {
      busy = false;
      updateControls();
    }
  });
  if (!window.grist) {
    status.textContent = 'Open this page as a Grist custom widget.';
    return;
  }
  grist.onOptions((options, interaction) => {
    access = interaction?.accessLevel === 'full';
    if (!access) generation++;
    load();
    updateControls();
  });
  grist.ready({requiredAccess: 'full'});
})();
