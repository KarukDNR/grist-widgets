'use strict';
(() => {
  // This widget replaces the native Timesheets selector. Its own selectors work
  // even before the employee has any Timesheets records.
  const cfg = window.CREATE_TIMESHEET_CONFIG;
  const employee = document.querySelector('#employee');
  const period = document.querySelector('#period');
  const create = document.querySelector('#create');
  const refresh = document.querySelector('#refresh');
  const status = document.querySelector('#status');
  let access = false, busy = false, loaded = false, generation = 0;
  let staff = [], periods = [], userName = '', identityNotice = '';
  const rows = table => (table.id || []).map((id, i) =>
    Object.fromEntries(Object.entries(table).map(([key, values]) => [key, values[i]])));
  const ref = value => Array.isArray(value) && value[0] === 'R' ? value[value.length - 1] : value;
  const retired = row => String(row[cfg.columns.staffStatus] || '').trim().toLowerCase() === 'retired';
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
  async function identifyUser() {
    if (userName) return;
    let rowId;
    identityNotice = '';
    try {
      // user.Name belongs to Grist trigger formulas, not browser JavaScript.
      // Add an empty helper row so its creation-only Name trigger identifies
      // this caller. Each request owns its own row, including concurrent users.
      const result = await grist.docApi.applyUserActions([['AddRecord', cfg.tables.user, null, {}]]);
      rowId = result.retValues?.[0];
      if (!Number.isInteger(rowId)) throw new Error('No helper row ID returned.');
      const table = await grist.docApi.fetchTable(cfg.tables.user);
      requireColumns(table, [cfg.columns.userName], cfg.tables.user);
      const value = rows(table).find(row => row.id === rowId)?.[cfg.columns.userName];
      if (typeof value !== 'string' || !value) throw new Error('The helper Name trigger did not return user.Name.');
      userName = value;
    } catch (error) {
      identityNotice = 'Could not default the employee: ' + error.message + ' Choose an employee manually; see the Widget_user setup.';
    } finally {
      if (Number.isInteger(rowId)) {
        try {
          await grist.docApi.applyUserActions([['RemoveRecord', cfg.tables.user, rowId]]);
        } catch (error) {
          identityNotice += ' Temporary Widget_user row ' + rowId + ' could not be removed: ' + error.message;
        }
      }
    }
  }
  async function load() {
    if (busy) return;
    const version = ++generation;
    loaded = false;
    if (!access) {
      status.textContent = 'Grant Full document access to load timesheets.';
      updateControls();
      return;
    }
    busy = true;
    updateControls();
    status.textContent = 'Loading employees and pay periods…';
    try {
      // Hide linked paid hours until Load timesheet confirms the intended row.
      await grist.setSelectedRows([]);
      const [people, payPeriods] = await Promise.all([
        grist.docApi.fetchTable(cfg.tables.staff), grist.docApi.fetchTable(cfg.tables.periods)
      ]);
      if (version !== generation || !access) return;
      requireColumns(people, [cfg.columns.staffName, cfg.columns.staffStatus], cfg.tables.staff);
      requireColumns(payPeriods, [cfg.columns.start, cfg.columns.end], cfg.tables.periods);
      await identifyUser();
      if (version !== generation || !access) return;
      staff = rows(people).filter(row => !retired(row)).sort((a, b) =>
        String(a[cfg.columns.staffName] || '').localeCompare(String(b[cfg.columns.staffName] || '')));
      periods = rows(payPeriods).filter(row => {
        const start = day(row[cfg.columns.start]), end = day(row[cfg.columns.end]);
        return start && end && start <= end;
      }).sort((a, b) => day(b[cfg.columns.end]).localeCompare(day(a[cfg.columns.end])));
      const matches = staff.filter(row => row[cfg.columns.staffName] === userName);
      const current = periods.filter(row => day(row[cfg.columns.start]) <= today() && today() <= day(row[cfg.columns.end]));
      options(employee, staff, row => row[cfg.columns.staffName] || '(Unnamed employee)', employee.value,
        matches.length === 1 ? String(matches[0].id) : '');
      options(period, periods, row => 'Ending ' + day(row[cfg.columns.end]), period.value,
        current.length === 1 ? String(current[0].id) : '');
      loaded = true;
      const notice = identityNotice || (matches.length !== 1 ?
        'No unique active Staff.Name matches the signed-in user. Choose an employee manually.' : '');
      status.textContent = (notice ? notice + ' ' : '') +
        (current.length === 1 ? 'Click Load timesheet to select or create it.' :
          'Choose a pay period; no single pay period contains today.');
    } catch (error) {
      if (version === generation) status.textContent = error.message;
    } finally {
      busy = false;
      updateControls();
    }
  }
  async function changed() {
    if (busy) return;
    busy = true;
    updateControls();
    try {
      await grist.setSelectedRows([]);
      status.textContent = 'Click Load timesheet to select or create it.';
    } catch (error) {
      status.textContent = 'Could not clear the linked selection: ' + error.message;
      loaded = false;
    } finally {
      busy = false;
      updateControls();
    }
  }
  employee.addEventListener('change', changed);
  period.addEventListener('change', changed);
  refresh.addEventListener('click', load);
  create.addEventListener('click', async () => {
    if (create.disabled || busy) return;
    const who = Number(employee.value), payPeriod = Number(period.value);
    busy = true;
    updateControls();
    status.textContent = 'Checking for an existing timesheet…';
    let created = false, rowId;
    try {
      // Recheck Status at click time too, so a retirement after Refresh cannot
      // create/select a timesheet for someone absent from the active list.
      const [table, people] = await Promise.all([
        grist.docApi.fetchTable(cfg.tables.timesheets), grist.docApi.fetchTable(cfg.tables.staff)
      ]);
      if (!access) throw new Error('Full document access is required.');
      requireColumns(people, [cfg.columns.staffStatus], cfg.tables.staff);
      const person = rows(people).find(row => row.id === who);
      if (!person || retired(person)) throw new Error('This employee is no longer active. Refresh the employee list.');
      requireColumns(table, [cfg.columns.who, cfg.columns.period], cfg.tables.timesheets);
      const existing = rows(table).filter(row =>
        ref(row[cfg.columns.who]) === who && ref(row[cfg.columns.period]) === payPeriod);
      if (existing.length > 1) throw new Error('Multiple timesheets already exist for this employee and period. Review them before continuing.');
      if (existing.length === 1) {
        rowId = existing[0].id;
      } else {
        // Write only the parent references; never write or modify paid hours.
        const result = await grist.docApi.applyUserActions([['AddRecord', cfg.tables.timesheets, null, {
          [cfg.columns.who]: who, [cfg.columns.period]: payPeriod
        }]]);
        created = true;
        rowId = result.retValues?.[0];
        if (!Number.isInteger(rowId)) throw new Error('No timesheet row ID returned. Click Load again to find it.');
      }
      if (!access) throw new Error('Full document access is required.');
      // Selected rows filter linked detail tables; the cursor supplies the
      // selected parent record to same-table links such as the print widget.
      await grist.setSelectedRows([rowId]);
      await grist.setCursorPos({rowId});
      status.textContent = created ? 'New timesheet created and selected. You can enter paid hours.' :
        'Existing timesheet selected. You can enter paid hours.';
    } catch (error) {
      // A failed selection must not imply that a successful insert was undone.
      status.textContent = (created ? 'Timesheet created, but could not select it. ' : 'Could not load timesheet: ') + error.message;
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
  grist.ready({requiredAccess: 'full', allowSelectBy: true});
})();
