// JXA-Skripte (osascript -l JavaScript) für Kalender, Erinnerungen, Kontakte, Notizen, Browser, Maus/Tastatur und Bildschirm.
// Eingaben kommen nur als Argument (JSON), nie in den Skripttext: keine Einschleusung über Titel oder Suchbegriffe.
// Jedes Skript gibt JSON zurück.

export const JXA = {
  calendarList: `function run(argv){const a=JSON.parse(argv[0]);const Cal=Application('Calendar');const from=new Date(a.from),to=new Date(a.to);const out=[];
for(const c of Cal.calendars()){if(a.calendar&&c.name()!==a.calendar)continue;const evs=c.events.whose({_and:[{startDate:{_lessThan:to}},{endDate:{_greaterThan:from}}]})();
for(const e of evs){out.push({calendar:c.name(),id:e.uid(),title:e.summary(),start:e.startDate().toISOString(),end:e.endDate().toISOString(),allDay:e.alldayEvent(),location:e.location()||''});if(out.length>=a.limit)break}}
return JSON.stringify(out)}`,
  calendarCreate: `function run(argv){const a=JSON.parse(argv[0]);const Cal=Application('Calendar');const cals=Cal.calendars().filter(c=>{try{return c.writable()}catch(e){return true}});
const cal=a.calendar?Cal.calendars.byName(a.calendar):cals[0];if(!cal)throw new Error('Kein beschreibbarer Kalender.');
const props={summary:a.title,startDate:new Date(a.start),endDate:new Date(a.end),alldayEvent:!!a.allDay};if(a.location)props.location=a.location;if(a.notes)props.description=a.notes;
const e=Cal.Event(props);cal.events.push(e);return JSON.stringify({id:e.uid(),calendar:cal.name()})}`,
  calendarDelete: `function run(argv){const a=JSON.parse(argv[0]);const Cal=Application('Calendar');for(const c of Cal.calendars()){const evs=c.events.whose({uid:a.id})();if(evs.length){evs[0].delete();return JSON.stringify({ok:true})}}return JSON.stringify({ok:false})}`,
  remindersList: `function run(argv){const a=JSON.parse(argv[0]);const R=Application('Reminders');const out=[];
for(const l of R.lists()){if(a.list&&l.name()!==a.list)continue;const rs=a.done?l.reminders():l.reminders.whose({completed:false})();
for(const r of rs){const due=r.dueDate();out.push({list:l.name(),id:r.id(),title:r.name(),due:due?due.toISOString():null,done:r.completed(),notes:(r.body()||'').slice(0,500)});if(out.length>=a.limit)return JSON.stringify(out)}}
return JSON.stringify(out)}`,
  reminderCreate: `function run(argv){const a=JSON.parse(argv[0]);const R=Application('Reminders');const l=a.list?R.lists.byName(a.list):R.defaultList();
const props={name:a.title};if(a.notes)props.body=a.notes;if(a.due)props.dueDate=new Date(a.due);const r=R.Reminder(props);l.reminders.push(r);return JSON.stringify({id:r.id(),list:l.name()})}`,
  reminderComplete: `function run(argv){const a=JSON.parse(argv[0]);const R=Application('Reminders');const r=R.reminders.byId(a.id);const before=r.completed();r.completed=a.done;return JSON.stringify({id:a.id,before})}`,
  reminderDelete: `function run(argv){const a=JSON.parse(argv[0]);const R=Application('Reminders');R.reminders.byId(a.id).delete();return JSON.stringify({ok:true})}`,
  contactsSearch: `function run(argv){const a=JSON.parse(argv[0]);const C=Application('Contacts');const ps=C.people.whose({name:{_contains:a.query}})();const out=[];
for(const p of ps.slice(0,a.limit)){out.push({name:p.name(),organization:p.organization()||'',emails:p.emails().map(e=>e.value()),phones:p.phones().map(e=>e.value()),birthday:p.birthDate()?p.birthDate().toISOString().slice(0,10):null})}
return JSON.stringify(out)}`,
  notesSearch: `function run(argv){const a=JSON.parse(argv[0]);const N=Application('Notes');const ns=a.query?N.notes.whose({_or:[{name:{_contains:a.query}},{plaintext:{_contains:a.query}}]})():N.notes();const out=[];
for(const n of ns.slice(0,a.limit)){out.push({id:n.id(),title:n.name(),modified:n.modificationDate().toISOString(),text:a.full?n.plaintext().slice(0,20000):n.plaintext().slice(0,300)})}
return JSON.stringify(out)}`,
  noteCreate: `function run(argv){const a=JSON.parse(argv[0]);const N=Application('Notes');const esc=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const body='<h1>'+esc(a.title)+'</h1>'+a.text.split('\\n').map(l=>'<div>'+(esc(l)||'<br>')+'</div>').join('');const f=a.folder?N.folders.byName(a.folder):N.defaultAccount().defaultFolder();
const n=N.Note({body});f.notes.push(n);return JSON.stringify({id:n.id()})}`,
  noteDelete: `function run(argv){const a=JSON.parse(argv[0]);const N=Application('Notes');N.notes.byId(a.id).delete();return JSON.stringify({ok:true})}`,
  browserRead: `function run(argv){const a=JSON.parse(argv[0]);const name=a.app;const B=Application(name);if(!B.running())return JSON.stringify({error:name+' ist nicht offen.'});
const js='document.body?document.body.innerText.slice(0,'+a.max+'):""';let url,title,text;
if(name==='Safari'){const t=B.windows[0].currentTab;url=t.url();title=t.name();if(a.text)text=B.doJavaScript(js,{in:t})}
else{const t=B.windows[0].activeTab;url=t.url();title=t.title();if(a.text)text=t.execute({javascript:js})}
return JSON.stringify({url,title,text})}`,
  browserOpen: `function run(argv){const a=JSON.parse(argv[0]);const B=Application(a.app);B.activate();
if(a.app==='Safari'){if(B.documents.length&&!a.newTab)B.documents[0].url=a.url;else{B.Document().make();B.documents[0].url=a.url}}
else{if(!B.windows.length)B.Window().make();const w=B.windows[0];if(a.newTab){w.tabs.push(B.Tab({url:a.url}))}else{w.activeTab.url=a.url}}
return JSON.stringify({ok:true})}`,
  screenSize: `ObjC.import('AppKit');const f=$.NSScreen.mainScreen.frame;JSON.stringify({width:f.size.width,height:f.size.height})`,
  mouse: `ObjC.import('CoreGraphics');function run(argv){const a=JSON.parse(argv[0]);const pt=(x,y)=>$.CGPointMake(x,y);
const post=(type,p,btn,clicks)=>{const e=$.CGEventCreateMouseEvent($(),type,p,btn);if(clicks)$.CGEventSetIntegerValueField(e,1,clicks);$.CGEventPost(0,e)};
const p=pt(a.x,a.y);const right=a.button==='right';const down=right?3:1,up=right?4:2,btn=right?1:0;
if(a.action==='move'){post(5,p,0)}
else if(a.action==='click'||a.action==='double'){post(5,p,0);const n=a.action==='double'?2:1;for(let i=1;i<=n;i++){post(down,p,btn,i);post(up,p,btn,i)}}
else if(a.action==='drag'){const q=pt(a.toX,a.toY);post(5,p,0);post(1,p,0);for(let i=1;i<=10;i++){post(6,pt(a.x+(a.toX-a.x)*i/10,a.y+(a.toY-a.y)*i/10),0);delay(0.02)}post(2,q,0)}
else if(a.action==='scroll'){post(5,p,0);const e=$.CGEventCreateScrollWheelEvent2($(),0,2,-(a.dy||0),-(a.dx||0),0);$.CGEventPost(0,e)}
return JSON.stringify({ok:true})}`,
  keyboard: `function run(argv){const a=JSON.parse(argv[0]);const S=Application('System Events');const using=(a.modifiers||[]).map(m=>m+' down');
if(a.text!==undefined&&a.text!==null){S.keystroke(a.text)}
else if(a.keyCode!==undefined){S.keyCode(a.keyCode,using.length?{using}:{})}
else{S.keystroke(a.key,using.length?{using}:{})}
return JSON.stringify({ok:true})}`,
  // Rechte, ohne nachzufragen: Bedienungshilfen und Bildschirmaufnahme.
  probe: `ObjC.import('ApplicationServices');ObjC.import('CoreGraphics');JSON.stringify({accessibility:$.AXIsProcessTrusted(),screen:$.CGPreflightScreenCaptureAccess()})`,
  requestAccessibility: `ObjC.import('ApplicationServices');ObjC.import('Foundation');const o=$.NSDictionary.dictionaryWithObjectForKey($.NSNumber.numberWithBool(true),$('AXTrustedCheckOptionPrompt'));JSON.stringify({accessibility:$.AXIsProcessTrustedWithOptions(o)})`,
  requestScreen: `ObjC.import('CoreGraphics');JSON.stringify({screen:$.CGRequestScreenCaptureAccess()})`,
} as const

// Tastennamen für die Tastatur (macOS-Tastencodes).
export const KEY_CODES: Record<string, number> = {
  return: 36, enter: 76, tab: 48, space: 49, delete: 51, backspace: 51, forwarddelete: 117, escape: 53, esc: 53,
  left: 123, right: 124, down: 125, up: 126, home: 115, end: 119, pageup: 116, pagedown: 121,
  f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97, f7: 98, f8: 100, f9: 101, f10: 109, f11: 103, f12: 111,
}
