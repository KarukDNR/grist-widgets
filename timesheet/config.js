/* Table/column IDs, not the labels shown in Grist. No document IDs or keys needed. */
window.TIMESHEET_CONFIG = {
  tables: {
    hours: 'Hours_paid',
    totals: 'Hours_paid_summary_Who_and_pay_period',
    staff: 'Staff',
    funds: 'Funds',
    periods: 'Pay_periods',
    holidays: 'Holidays' // Date column supplies the observed holiday dates.
  },
  program: 'DNR', // Staff.Program takes precedence if added.
  payDateColumn: 'Pay_date', // Optional Date column on Pay_periods; blank until added.
  banner: 'assets/letterhead.png', // Optional; falls back to plain Karuk Tribe text.
  minimumRows: 11,
  holidayDates: [] // Optional ISO dates, e.g. ['2026-09-25']; otherwise no holiday shading.
};
