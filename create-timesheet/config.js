// Document-specific settings, loaded by index.html before widget.js.
// Use Grist's actual table/column IDs, which can differ from visible labels.
// The window property makes this one configuration object available to widget.js.
window.CREATE_TIMESHEET_CONFIG = {
  // staff: employee names and retirement status for the dropdown.
  // periods: date ranges used to choose the current period and display others.
  // timesheets: parent records the Load button finds, creates, and selects.
  // user: temporary identity bridge; Name must have a creation-only user.Name
  // trigger. The widget removes the helper row after reading it.
  tables: {staff: 'Staff', periods: 'Pay_periods', timesheets: 'Timesheets', user: 'Widget_user'},
  // staffName/staffStatus belong to Staff; userName belongs to Widget_user.
  // start/end belong to Pay_periods (Date columns).
  // who/period belong to Timesheets and must be references to Staff/Pay_periods.
  // The widget compares/writes reference row IDs, not their display text.
  columns: {staffName: 'Name', staffStatus: 'Status', userName: 'Name', start: 'Start_date', end: 'End_date', who: 'Who', period: 'Pay_period_end'},
  // Determines today's calendar date, independent of the viewer's computer.
  // Used for the inclusive Start_date <= today <= End_date default.
  timezone: 'America/Los_Angeles'
};
