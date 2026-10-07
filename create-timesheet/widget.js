'use strict';
// LOAD TIMESHEET: a selector and an on-demand parent-record creator.
//
// Read this file in three parts:
//   1. Small helpers translate Grist data and control the HTML form.
//   2. identifyUser/load prepare the employee and pay-period dropdowns.
//   3. The click handler finds or creates a Timesheets row, then links it.
//
// Data flow: Staff + Pay_periods -> dropdowns -> Timesheets -> linked widgets.
// Hours_paid is never written here. Grist supplies its selected Timesheets
// reference when users add paid-hours rows in a properly linked table widget.
//
// This immediately invoked function (the final "()" calls it) keeps variables
// private, rather than adding every helper and state variable to window.
(() => {
  // This widget replaces the native Timesheets selector. Its own selectors work
  // even before the employee has any Timesheets records.
  // config.js loads first. Keeping document-specific IDs there lets the same
  // logic work with renamed tables/columns without editing this script.
  const cfg = window.CREATE_TIMESHEET_CONFIG;
  // querySelector finds an element in index.html by its id (the # prefix).
  // These variables hold the actual HTML elements; assigning textContent or
  // disabled below changes what the user sees in the existing page.
  const employee = document.querySelector('#employee');
  const period = document.querySelector('#period');
  // The historical id/variable "create" is retained, but the button now says
  // Load timesheet and handles both existing and new records.
  const create = document.querySelector('#create');
  const refresh = document.querySelector('#refresh');
  const status = document.querySelector('#status');
  // State for this iframe only:
  // access: Grist granted Full document access (table rules still apply).
  // busy: an API operation is running; prevents overlapping clicks/refreshes.
  // loaded: the dropdown data is usable, rather than empty or partially read.
  // generation: a load's version number. Permission loss invalidates a pending
  // read, so its eventual response cannot repopulate the form with stale data.
  let access = false, busy = false, loaded = false, generation = 0;
  // Cache lists for rendering and the caller's name for this iframe session.
  // Do not save userName in shared widget options: another user would inherit it.
  let staff = [], periods = [], userName = '', identityNotice = '';
  // fetchTable returns columns: {id: [1, 2], Name: ['Alice', 'Bob']}.
  // Convert them to rows: [{id: 1, Name: 'Alice'}, {id: 2, Name: 'Bob'}].
  // map visits each item; Object.entries exposes key/value pairs, and
  // Object.fromEntries assembles them back into an object for that row.
  const rows = table => (table.id || []).map((id, i) =>
    Object.fromEntries(Object.entries(table).map(([key, values]) => [key, values[i]])));
  // References may be a numeric row ID or an encoded ['R', tableId, rowId].
  // Compare IDs, rather than displayed employee names or pay-period dates.
  const ref = value => Array.isArray(value) && value[0] === 'R' ? value[value.length - 1] : value;
  // Normalize only Status; employee identity below still uses exact names.
  // Excluding retired people is a UI rule, not a substitute for access rules.
  const retired = row => String(row[cfg.columns.staffStatus] || '').trim().toLowerCase() === 'retired';
  // Normalize Grist dates (encoded values, Unix seconds, or date strings) to
  // YYYY-MM-DD. This format sorts chronologically using string comparisons.
  // UTC extraction preserves the calendar date of Grist Date-column values;
  // it avoids shifting midnight back a day in a western browser timezone.
  function day(value) {
    if (Array.isArray(value) && ['D','d'].includes(value[0])) value = value[1];
    if (value === null || value === undefined || value === '') return null;
    const date = new Date(typeof value === 'number' ? value * 1000 : value);
    return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
  }
  // In contrast, "today" is a local calendar day in the configured timezone.
  // A browser elsewhere, or a UTC timestamp near midnight, must not default
  // the widget to a different pay period than the department's local date.
  function today() {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: cfg.timezone, year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const get = type => parts.find(part => part.type === type).value;
    return get('year') + '-' + get('month') + '-' + get('day');
  }
  // Fail with an actionable configuration error instead of quietly treating
  // a misspelled column ID as an empty table or missing employee reference.
  function requireColumns(table, columns, name) {
    for (const column of columns) {
      if (!(column in table)) throw new Error(name + ' is missing column ' + column + '. Check config.js.');
    }
  }
  // One place decides which controls are usable. Calls before/after awaits
  // prevent duplicate clicks and changes to employee/period mid-operation.
  // ! means "not"; || means "or": any unmet requirement disables the button.
  function updateControls() {
    employee.disabled = period.disabled = !access || busy || !loaded;
    refresh.disabled = !access || busy;
    create.disabled = !access || busy || !loaded || !employee.value || !period.value;
  }
  // Rebuild a dropdown with a blank placeholder. Each option shows a friendly
  // label but stores its row ID as a string (HTML select values are strings).
  // Preserve a still-valid manual choice on Refresh; use the default only
  // when the old choice is absent. Never arbitrarily choose the first record.
  // label is a function supplied by the caller to format each option's text.
  function options(select, records, label, previous, fallback = '') {
    select.replaceChildren(new Option('Select…', ''));
    for (const row of records) select.add(new Option(label(row), String(row.id)));
    select.value = records.some(row => String(row.id) === previous) ? previous : fallback;
  }
  // async functions return a Promise. await pauses this function until an
  // API response arrives without blocking the browser's entire interface.
  // A helper record bridges Grist's server-side user.Name trigger to this
  // browser. Missing setup is recoverable: keep manual selection available.
  async function identifyUser() {
    if (userName) return;
    let rowId;
    identityNotice = '';
    try {
      // user.Name belongs to Grist trigger formulas, not browser JavaScript.
      // Add an empty helper row so its creation-only Name trigger identifies
      // this caller. Each request owns its own row, including concurrent users.
      const result = await grist.docApi.applyUserActions([['AddRecord', cfg.tables.user, null, {}]]);
      // null in AddRecord asks Grist to allocate the ID; {} supplies no fields,
      // leaving Name to the trigger. retValues[0] is the first action's result.
      // ?. safely returns undefined if retValues is absent.
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
      // finally runs after success OR failure, even if reading Name failed.
      // Delete only our row, never all helper rows: other users may be loading.
      if (Number.isInteger(rowId)) {
        try {
          await grist.docApi.applyUserActions([['RemoveRecord', cfg.tables.user, rowId]]);
        } catch (error) {
          identityNotice += ' Temporary Widget_user row ' + rowId + ' could not be removed: ' + error.message;
        }
      }
    }
  }
  // Initialize or refresh the form. This does not load/create a timesheet;
  // that requires an explicit click after reviewing the two dropdowns.
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
      // These reads are independent, so start both and await both together.
      // Destructuring assigns the first result to people and second to payPeriods.
      const [people, payPeriods] = await Promise.all([
        grist.docApi.fetchTable(cfg.tables.staff), grist.docApi.fetchTable(cfg.tables.periods)
      ]);
      if (version !== generation || !access) return;
      requireColumns(people, [cfg.columns.staffName, cfg.columns.staffStatus], cfg.tables.staff);
      requireColumns(payPeriods, [cfg.columns.start, cfg.columns.end], cfg.tables.periods);
      await identifyUser();
      if (version !== generation || !access) return;
      // filter keeps eligible records; sort makes the dropdown predictable.
      // Invalid/reversed periods are omitted rather than used as defaults.
      staff = rows(people).filter(row => !retired(row)).sort((a, b) =>
        String(a[cfg.columns.staffName] || '').localeCompare(String(b[cfg.columns.staffName] || '')));
      periods = rows(payPeriods).filter(row => {
        const start = day(row[cfg.columns.start]), end = day(row[cfg.columns.end]);
        return start && end && start <= end;
      }).sort((a, b) => day(b[cfg.columns.end]).localeCompare(day(a[cfg.columns.end])));
      // Exactly one match is required for either default. Duplicate names or
      // overlapping pay periods need a manual choice, not a guessed identity.
      // Both boundary comparisons include the start and end dates.
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
  // A changed dropdown is an intention, not a loaded parent. Clear outgoing
  // links until Load confirms it, to avoid entering hours against the previous
  // employee/period while the form displays the new choice.
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
  // Register callbacks: the browser runs these later in response to events.
  // Passing changed (without parentheses) registers it rather than calling it.
  employee.addEventListener('change', changed);
  period.addEventListener('change', changed);
  refresh.addEventListener('click', load);
  create.addEventListener('click', async () => {
    if (create.disabled || busy) return;
    // Capture choices before awaiting anything. Convert HTML string values
    // to numeric row IDs for Grist Reference fields, then lock the controls.
    const who = Number(employee.value), payPeriod = Number(period.value);
    busy = true;
    updateControls();
    status.textContent = 'Checking for an existing timesheet…';
    // Remember whether the insert succeeded separately from selection, since
    // a later linking failure does not roll back a successfully added record.
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
      // Always use a fresh read: another user may have created this timesheet
      // since our dropdowns loaded. Match both references, not a concatenated
      // key, and stop on duplicates instead of choosing an arbitrary parent.
      // This read-then-add is not atomic; simultaneous users can still race.
      const existing = rows(table).filter(row =>
        ref(row[cfg.columns.who]) === who && ref(row[cfg.columns.period]) === payPeriod);
      if (existing.length > 1) throw new Error('Multiple timesheets already exist for this employee and period. Review them before continuing.');
      if (existing.length === 1) {
        rowId = existing[0].id;
      } else {
        // Write only the parent references; never write or modify paid hours.
        // applyUserActions accepts a list of actions. Computed keys [cfg...]
        // use the configured column IDs; Grist runs its usual defaults/triggers.
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
  // A standalone browser visit has no Grist API. Show a useful message;
  // this page is intended to run inside a document's custom-widget iframe.
  if (!window.grist) {
    status.textContent = 'Open this page as a Grist custom widget.';
    return;
  }
  // Grist reports the granted access level through onOptions. Register this
  // before ready so initialization waits for that permission information.
  // Full access permits document-wide API calls, not bypassing table rules.
  grist.onOptions((options, interaction) => {
    access = interaction?.accessLevel === 'full';
    if (!access) generation++;
    load();
    updateControls();
  });
  // Full access is needed to read other tables and create parent/helper rows.
  // allowSelectBy advertises this widget as a source in other widgets' Select
  // By menus. It does not wire those links automatically; see the README.
  grist.ready({requiredAccess: 'full', allowSelectBy: true});
})();
