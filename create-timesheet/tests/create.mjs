import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const config = fs.readFileSync(new URL('../config.js', import.meta.url), 'utf8');
const script = fs.readFileSync(new URL('../widget.js', import.meta.url), 'utf8');
class Element {
  value = ''; disabled = true; textContent = ''; choices = [];
  addEventListener(event, handler) { this[event] = handler; }
  replaceChildren(...options) { this.choices = options; this.value = ''; }
  add(option) { this.choices.push(option); }
}
class Clock extends Date {
  constructor(...args) { super(...(args.length ? args : ['2026-10-04T00:30:00Z'])); }
}
function fixture({name='Judson Fisher', missingHelper=false, cleanupError=false, duplicateName=false}={}) {
  const elements = Object.fromEntries(['employee','period','create','refresh','status'].map(id => ['#'+id,new Element()]));
  const tables = {
    Staff: {id:[1,2,3],Name:['Judson Fisher',duplicateName?'Judson Fisher':'Other Employee','Retired Employee'],
      Status:['active','active','retired']},
    Pay_periods: {id:[48,47],Start_date:['2026-09-20','2026-09-06'],End_date:['2026-10-03','2026-09-19']},
    Timesheets: {id:[],Who:[],Pay_period_end:[]},
    Widget_user: {id:[],Name:[]}
  };
  const state={writes:0,helpers:0,removals:0,failWrite:false,failSelect:false,gate:null,selected:null,cursor:null};
  const handlers={};
  const context=vm.createContext({
    Date:Clock,Intl,Option:class {constructor(text,value){this.text=text;this.value=value;}},
    document:{querySelector:id=>elements[id]},
    grist:{
      ready:options=>{assert.equal(options.requiredAccess,'full');assert.equal(options.allowSelectBy,true);},
      onOptions:fn=>handlers.options=fn,
      setSelectedRows:async ids=>{
        if(state.failSelect) throw new Error('Selection denied');
        state.selected=Array.from(ids);
      },
      setCursorPos:async pos=>{state.cursor=pos.rowId;},
      docApi:{
        fetchTable:async table=>{
          if(table==='Widget_user'&&missingHelper) throw new Error('Missing helper table');
          assert.ok(tables[table],table);
          if(table==='Timesheets'&&state.gate) await state.gate;
          return tables[table];
        },
        applyUserActions:async actions=>{
          assert.equal(actions.length,1);
          const [kind,table,id,fields]=actions[0];
          if(table==='Widget_user'){
            if(missingHelper)throw new Error('Missing helper table');
            if(kind==='AddRecord'){
              assert.equal(Object.keys(fields).length,0);
              const next=++state.helpers;
              tables.Widget_user.id.push(next);tables.Widget_user.Name.push(name);
              return {retValues:[next]};
            }
            assert.equal(kind,'RemoveRecord');
            if(cleanupError)throw new Error('Delete denied');
            const i=tables.Widget_user.id.indexOf(id);assert.ok(i>=0);
            tables.Widget_user.id.splice(i,1);tables.Widget_user.Name.splice(i,1);
            state.removals++;return {retValues:[null]};
          }
          if(state.failWrite)throw new Error('Access denied');
          assert.equal(kind,'AddRecord');assert.equal(table,'Timesheets');assert.equal(id,null);
          assert.deepEqual(Object.keys(fields).sort(),['Pay_period_end','Who']);
          const next=++state.writes;
          tables.Timesheets.id.push(next);tables.Timesheets.Who.push(fields.Who);
          tables.Timesheets.Pay_period_end.push(fields.Pay_period_end);
          return {retValues:[next]};
        }
      }
    }
  });
  context.window=context;vm.runInContext(config,context);vm.runInContext(script,context);
  return {elements,tables,state,handlers};
}
const settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
const start=async f=>{f.handlers.options({}, {accessLevel:'full'});await settle();};
const f=fixture();const {elements:e,tables:t,state:s,handlers:h}=f;
h.options({}, {accessLevel:'read table'});await settle();
assert.equal(e['#create'].disabled,true);assert.equal(s.helpers,0);
await start(f);
assert.equal(e['#period'].value,'48'); // Inclusive last day in California, despite UTC Oct 4.
assert.equal(e['#employee'].value,'1');
assert.equal(s.helpers,1);assert.equal(s.removals,1);assert.equal(t.Widget_user.id.length,0);
assert.ok(!e['#employee'].choices.some(o=>o.value==='3'));
assert.deepEqual(s.selected,[]);
await e['#create'].click();
assert.equal(s.writes,1);assert.equal(t.Timesheets.Who[0],1);assert.equal(t.Timesheets.Pay_period_end[0],48);
assert.deepEqual(s.selected,[1]);assert.equal(s.cursor,1);
assert.match(e['#status'].textContent,/New timesheet created and selected/);
await e['#create'].click();
assert.equal(s.writes,1);assert.match(e['#status'].textContent,/Existing timesheet selected/);
t.Timesheets.Who[0]=['R','Staff',1];t.Timesheets.Pay_period_end[0]=['R','Pay_periods',48];
await e['#create'].click();assert.equal(s.writes,1);assert.equal(s.cursor,1);
t.Timesheets.id.push(99);t.Timesheets.Who.push(1);t.Timesheets.Pay_period_end.push(48);
await e['#create'].click();assert.match(e['#status'].textContent,/Multiple timesheets/);assert.equal(s.writes,1);
e['#period'].value='47';await e['#period'].change();assert.deepEqual(s.selected,[]);
let release;s.gate=new Promise(resolve=>release=resolve);
const first=e['#create'].click();assert.equal(e['#create'].disabled,true);
await e['#create'].click();release();await first;s.gate=null;
assert.equal(s.writes,2);assert.equal(t.Timesheets.Pay_period_end.at(-1),47);assert.equal(s.cursor,2);
e['#employee'].value='2';await e['#employee'].change();s.failWrite=true;
await e['#create'].click();assert.match(e['#status'].textContent,/Access denied/);assert.equal(s.writes,2);
s.failWrite=false;s.failSelect=true;
await e['#create'].click();assert.equal(s.writes,3);
assert.match(e['#status'].textContent,/Timesheet created, but could not select/);
s.failSelect=false;await e['#create'].click();assert.equal(s.writes,3);assert.equal(s.cursor,3);
// Retirement after the list was loaded is blocked at click time.
t.Staff.Status[1]=' RETIRED ';
await e['#create'].click();assert.match(e['#status'].textContent,/no longer active/);assert.equal(s.writes,3);
await e['#refresh'].click();assert.ok(!e['#employee'].choices.some(o=>o.value==='2'));
assert.equal(e['#employee'].value,'1');assert.equal(s.helpers,1);
e['#period'].value='';
t.Pay_periods={id:[60],Start_date:['2026-12-01'],End_date:['2026-12-14']};
await e['#refresh'].click();assert.equal(e['#period'].value,'');assert.equal(e['#create'].disabled,true);
h.options({}, {accessLevel:'read table'});await settle();
assert.equal(e['#employee'].disabled,true);assert.equal(e['#create'].disabled,true);
for(const opts of [{missingHelper:true},{name:'Unknown User'},{name:'Retired Employee'},{duplicateName:true}]){
  const other=fixture(opts);await start(other);
  assert.equal(other.elements['#employee'].value,'');assert.equal(other.elements['#create'].disabled,true);
  other.elements['#employee'].value='1';await other.elements['#employee'].change();
  await other.elements['#create'].click();assert.equal(other.state.writes,1);
}
const cleanup=fixture({cleanupError:true});await start(cleanup);
assert.equal(cleanup.elements['#employee'].value,'1');
assert.match(cleanup.elements['#status'].textContent,/row 1 could not be removed/);
assert.equal(cleanup.tables.Widget_user.id.length,1);
console.log('PASS: signed-in default, helper cleanup/fallback, retired filtering, timezone, create/reuse/select, choice clearing, duplicate checks, double-click lock, errors, and permissions.');
