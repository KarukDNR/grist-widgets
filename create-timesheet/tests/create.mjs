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
const elements = Object.fromEntries(['employee','period','create','refresh','status'].map(id => ['#'+id,new Element()]));
const tables = {
  Staff: {id:[1,2],Name:['Judson Fisher','Other Employee']},
  Pay_periods: {id:[48,47],Start_date:['2026-09-20','2026-09-06'],End_date:['2026-10-03','2026-09-19']},
  Timesheets: {id:[],Who:[],Pay_period_end:[]}
};
let writes = 0, failWrite = false, gate = null;
const handlers = {};
class Clock extends Date {
  constructor(...args) { super(...(args.length ? args : ['2026-10-04T00:30:00Z'])); }
}
const context = vm.createContext({
  Date: Clock, Intl, Option: class {constructor(text,value) {this.text=text; this.value=value;}},
  document: {querySelector:id=>elements[id]},
  grist: {
    ready:options=>assert.equal(options.requiredAccess,'full'),
    onOptions:fn=>handlers.options=fn,
    docApi: {
      fetchTable:async name=>{assert.ok(tables[name],name); if(name==='Timesheets'&&gate) await gate; return tables[name];},
      applyUserActions:async actions=>{
        if(failWrite) throw new Error('Access denied');
        assert.equal(actions.length,1);
        const [kind,name,id,fields]=actions[0];
        assert.equal(kind,'AddRecord'); assert.equal(name,'Timesheets'); assert.equal(id,null);
        assert.deepEqual(Object.keys(fields).sort(),['Pay_period_end','Who']);
        writes++;
        tables.Timesheets.id.push(writes); tables.Timesheets.Who.push(fields.Who);
        tables.Timesheets.Pay_period_end.push(fields.Pay_period_end);
      }
    }
  }
});
context.window = context;
vm.runInContext(config,context); vm.runInContext(script,context);
const settle=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));};
handlers.options({}, {accessLevel:'read table'}); await settle();
assert.equal(elements['#create'].disabled,true);
handlers.options({}, {accessLevel:'full'}); await settle();
// Oct 4 UTC is still Oct 3 in California: default includes the final day.
assert.equal(elements['#period'].value,'48');
assert.equal(elements['#employee'].value,'');
elements['#employee'].value='1'; elements['#employee'].change();
assert.equal(elements['#create'].disabled,false);
await elements['#create'].click();
assert.equal(writes,1);
assert.equal(tables.Timesheets.Who[0],1); assert.equal(tables.Timesheets.Pay_period_end[0],48);
assert.match(elements['#status'].textContent,/created/);
await elements['#create'].click();
assert.equal(writes,1); assert.match(elements['#status'].textContent,/already exists/);

// Fresh check handles encoded references and identifies ambiguous duplicates.
tables.Timesheets.Who[0]=['R','Staff',1];
tables.Timesheets.Pay_period_end[0]=['R','Pay_periods',48];
await elements['#create'].click(); assert.equal(writes,1);
tables.Timesheets.id.push(99); tables.Timesheets.Who.push(1); tables.Timesheets.Pay_period_end.push(48);
await elements['#create'].click();
assert.match(elements['#status'].textContent,/Multiple timesheets/); assert.equal(writes,1);

// Historical period creation and double-click lock.
elements['#period'].value='47'; elements['#period'].change();
let release; gate=new Promise(resolve=>release=resolve);
const first=elements['#create'].click();
assert.equal(elements['#create'].disabled,true);
await elements['#create'].click(); release(); await first; gate=null;
assert.equal(writes,2); assert.equal(tables.Timesheets.Pay_period_end.at(-1),47);

elements['#employee'].value='2'; elements['#employee'].change();
failWrite=true; await elements['#create'].click();
assert.match(elements['#status'].textContent,/Access denied/); assert.equal(writes,2);
assert.equal(elements['#create'].disabled,false); failWrite=false;

// No matching current period must not silently choose another one.
elements['#period'].value='';
tables.Pay_periods={id:[60],Start_date:['2026-12-01'],End_date:['2026-12-14']};
await elements['#refresh'].click();
assert.equal(elements['#period'].value,''); assert.equal(elements['#create'].disabled,true);

// Permission loss blocks creation and stale read completion.
handlers.options({}, {accessLevel:'read table'}); await settle();
assert.equal(elements['#employee'].disabled,true);
assert.equal(elements['#create'].disabled,true);
console.log('PASS: timezone and inclusive current-period default, explicit employee, creation, fresh duplicate checks, historical entry, double-click lock, errors, and permission blocking.');
