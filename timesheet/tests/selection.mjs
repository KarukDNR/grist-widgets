import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const days = ['Sun1','Mon1','Tue1','Wed1','Thu1','Fri1','Sat1','Sun2','Mon2','Tue2','Wed2','Thu2','Fri2','Sat2'];
const daily = values => Object.fromEntries(days.map((day, i) => [day, values.map(value => i === 1 ? value : 0)]));
const elements = Object.fromEntries(['#report','#status','#print','#refresh'].map(key => [key, {
  hidden: true, disabled: true, innerHTML: '', textContent: '',
  replaceChildren() { this.innerHTML = ''; },
  addEventListener(type, fn) { this[type] = fn; }
}]));
const tables = {
  // No Who or Pay_period_end on paid rows: the stored reference is authoritative.
  Hours_paid: {id:[10,11], Timesheets:[['R','Timesheets',7],8], Fund:[4,4], Hours_type:['Holiday','Regular'], Total_hours:[8,99], ...daily([8,99])},
  Hours_paid_summary_Who_and_pay_period: {id:[50], group:[['L',10]], Total:[12], ...daily([12])},
  Staff: {id:[1], Name:['Person'], Title:['Specialist'], Program:[1]},
  Programs: {id:[1], Name:['Natural Resources']},
  Funds: {id:[4], Name:['Test Fund'], Code:['123']},
  Pay_periods: {id:[3], Start_date:['2026-09-20'], End_date:['2026-10-03']},
  Holidays: {id:[], Date:[]}
};
const handlers = {};
let printed = 0;
const context = vm.createContext({
  URLSearchParams, location:{search:''},
  document:{querySelector:key=>elements[key], fonts:{ready:Promise.resolve()}},
  grist:{
    docApi:{fetchTable:async name=>{assert.ok(tables[name], name); return tables[name];}},
    onOptions:fn=>handlers.options=fn,
    onRecord:(fn, options)=>{assert.equal(options.expandRefs,false); assert.equal(options.keepEncoded,true); handlers.record=fn;},
    onRecords:fn=>handlers.records=fn,
    ready:()=>{}
  }
});
context.window = context;
context.print = () => printed++;
vm.runInContext(fs.readFileSync(new URL('../config.js', import.meta.url),'utf8'),context);
context.TIMESHEET_CONFIG.banner = null;
context.TIMESHEET_CONFIG.tables.totals = 'Hours_paid_summary_Who_and_pay_period';
vm.runInContext(fs.readFileSync(new URL('../timesheet.js', import.meta.url),'utf8'),context);
const settle = async () => {for (let i=0;i<5;i++) await new Promise(resolve=>setImmediate(resolve));};
const refresh = async () => {elements['#refresh'].click(); await settle();};
const visible = () => assert.equal(elements['#report'].hidden,false,elements['#status'].textContent);
handlers.options({}, {accessLevel:'full'});
handlers.record({id:7,Who:['R','Staff',1],Pay_period_end:['R','Pay_periods',3]});
await settle();
visible();
assert.match(elements['#report'].innerHTML,/<td class="fund-label"><span class="hours-type">HOLIDAY<\/span> Test Fund<br>/);
assert.doesNotMatch(elements['#report'].innerHTML,/<col class="type">/);
assert.match(elements['#report'].innerHTML,/<col class="fund">/);
tables.Hours_paid.Hours_type[0]='rEgUlAr';
await refresh(); visible();
assert.match(elements['#report'].innerHTML,/<td class="fund-label">Test Fund<br>/);
assert.doesNotMatch(elements['#report'].innerHTML,/<span class="hours-type">/);
tables.Hours_paid.Hours_type[0]='sick leave';
await refresh(); visible();
assert.match(elements['#report'].innerHTML,/<span class="hours-type">SICK LEAVE<\/span> Test Fund<br>/);
tables.Hours_paid.Hours_type[0]='Holiday';
assert.match(elements['#report'].innerHTML,/12.00/,'Use authoritative Grist total, not sum of detail rows');
assert.match(elements['#report'].innerHTML,/10-03-26/);
assert.match(elements['#report'].innerHTML,/<b>Program:<\/b><span class="value">Natural Resources<\/span>/);
tables.Staff.Program[0]=['R','Programs',1];
await refresh(); visible();
assert.match(elements['#report'].innerHTML,/<b>Program:<\/b><span class="value">Natural Resources<\/span>/);
tables.Staff.Program[0]=null;
await refresh(); visible();
assert.match(elements['#report'].innerHTML,/<b>Program:<\/b><span class="value">DNR<\/span>/);
tables.Staff.Program[0]=1;
elements['#report'].querySelectorAll = () => [{decode:async()=>{}}];
await elements['#print'].click();
assert.equal(printed,1);

const summary = tables.Hours_paid_summary_Who_and_pay_period;
delete summary.group;
summary.Timesheets = [['R','Timesheets',7]];
await refresh(); visible();
summary.Timesheets = [8];
await refresh();
assert.equal(elements['#print'].disabled,true);
assert.match(elements['#status'].textContent,/Could not identify/);
summary.Timesheets = [7];
summary.id.push(51); summary.Timesheets.push(7); summary.Total.push(12);
await refresh();
assert.equal(elements['#print'].disabled,true,'Duplicate summaries must block printing');
summary.id.pop(); summary.Timesheets.pop(); summary.Total.pop();
delete summary.Timesheets;
summary.Who=[1]; summary.Pay_period_end=[3];
await refresh(); visible();

context.TIMESHEET_CONFIG.timesheetColumn='Timesheet';
tables.Hours_paid.Timesheet=tables.Hours_paid.Timesheets;
delete tables.Hours_paid.Timesheets;
await refresh(); visible();
tables.Hours_paid.Mon1[0]=['E','formula error'];
await refresh();
assert.equal(elements['#print'].disabled,true);
assert.match(elements['#status'].textContent,/non-numeric/);
tables.Hours_paid.Mon1[0]=8;
handlers.record({id:9,Who:1,Pay_period_end:3});
await settle();
assert.match(elements['#status'].textContent,/No paid-hour rows/);
handlers.record(null); await settle();
assert.equal(elements['#report'].hidden,true);
handlers.record({id:7,Who:0,Pay_period_end:3}); await settle();
assert.match(elements['#status'].textContent,/Select a Timesheets row/);
console.log('PASS: timesheet-reference selection, combined grant/type column, program names and fallback, leave-only rows, encoded refs, authoritative summaries, alternate column ID, print, and invalid/empty selection.');
