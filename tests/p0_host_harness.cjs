// Execute the actual compiled plugin in a mocked Editor host. XML parsing uses
// Python's real XML parser, NOT the production FairyGUI XML binding (live test required).
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/p0-persistence/initial.xml'), 'utf8');
function parseXML(text) {
  const r = cp.spawnSync(process.env.PYTHON || 'python3', ['-c', `import sys,json,xml.etree.ElementTree as E
r=E.fromstring(sys.stdin.read())
def node(n): return dict(name=n.tag,attrs=n.attrib,children=[node(c) for c in n])
print(json.dumps(node(r)))`], {input:text, encoding:'utf8'});
  if (r.status) throw Error(r.stderr);
  return JSON.parse(r.stdout);
}
class XML {
  constructor(text) { this.data = typeof text === 'string' ? parseXML(text) : text; this.name=this.data.name; }
  GetAttribute(k) { return this.data.attrs[k] ?? null; }
  GetNode(k) { const n=this.data.children.find(n=>n.name===k);return n ? new XML(n):null; }
  get elements() { const a=this.data.children;return {Count:a.length,get_Item:i=>new XML(a[i])}; }
}
function Color(r,g,b,a) { Object.assign(this,{r,g,b,a}); }
const results=[];
let ctx,doc,objects,files,resources,saveMode,replaceMode,replaceCount;
let closeMode,openMode,dropOnReload,closeCount,closeUsed;
function setup() {
 files={'fixture.xml':fixture};saveMode='normal';replaceMode='normal';replaceCount=0;
 closeMode='normal';openMode='normal';dropOnReload=false;closeCount=0;closeUsed=[];
 const resource=(id,w=64,h=64)=>({id,owner:{id:'fixture0'},type:'image',width:w,height:h,GetURL:()=>`ui://fixture0${id}`});
 resources={'ui://fixture0red':resource('red'),'ui://fixture0blue':resource('blue',128,128)};
 objects=[{id:'image1',name:'picture',objectType:'image',resourceURL:'ui://fixture0red',width:64,height:64,x:10,y:20}, {id:'loader1',name:'icon',objectType:'loader',url:'ui://fixture0red',width:64,height:64,x:80,y:20}, {id:'text1',name:'title',objectType:'text',font:'',fontSize:24,color:new Color(1,1,1,1),align:'center',verticalAlign:'middle',leading:4,letterSpacing:1,autoSize:'none',width:240,height:60,x:0,y:100}];
 for(const o of objects)Object.assign(o,{scaleX:1,scaleY:1,rotation:0,alpha:1,visible:true,touchable:true,grayed:false,text:'',icon:'',GetProperty(p){return this[p];},SetProperty(p,v){this[p]=v;}});
 doc=makeDoc();
 resources['ui://fixture0component']={file:'fixture.xml',owner:{id:'fixture0'}};
 const docView={
  CloseDocuments(url){ if(closeMode==='plural-throw'||closeMode==='none')throw Error('invalid arguments ... or the overload is striped by unity'); closeCount++;closeUsed.push('CloseDocuments');closeAndReload(); },
  CloseDocument(url){ if(closeMode==='none')throw Error('or the overload is striped by unity'); closeCount++;closeUsed.push('CloseDocument');closeAndReload(); },
  OpenDocument(url){ if(openMode==='throw')throw Error('open failed'); if(openMode==='null')return null; doc=makeDoc(); return doc; }
 };
 const app={project:{GetItemByURL:url=>resources[url] || null},docView};
 ctx=vm.createContext({exports:{},CS:{FairyEditor:{App:app,FPackageItemType:{IMAGE:'image',FONT:'font'}},UnityEngine:{Application:{runInBackground:false},Color,Vector2:function(x,y){this.x=x;this.y=y;}},System:{IO:{File:{Exists:p=>p in files,ReadAllText:p=>files[p]},Directory:{},Path:{},FileInfo:{},SearchOption:{}}},FairyGUI:{Utils:{XML}}},require:()=>({}),console});
 const code=fs.readFileSync(path.join(root,'plugin/main.js'),'utf8').split('App.add_onUpdate(onUpdate);')[0];
 vm.runInContext(code,ctx);
 ctx.getActiveDocument=()=>doc;
 ctx.resolveObject=(_,t)=>{const o=objects.find(o=>o.id===t.id);if(!o)throw Error('未找到对象 ID');return o;};
 ctx.findObjectById=(_,id)=>objects.find(o=>o.id===id)||null;
 ctx.describeObject=o=>({id:o.id});ctx.describeDocument=()=>({modified:doc.isModified});
}
function makeDoc(){
 const d={content:{resourceURL:'ui://fixture0component'},docURL:'ui://fixture0component',dead:false,
  history:{CanUndo:()=>false,CanRedo:()=>false,GetPendingList:()=>({Count:0})},
  SetModified(v){this.isModified=v;},RefreshInspectors(){},SetSelection(o){this.selected=o;},SelectObject(){},
  ReplaceSelection(url){replaceCount++;if(replaceMode==='ignore')return;const i=objects.indexOf(this.selected);objects[i]={...this.selected,resourceURL:url};},
  InsertObject(url,pos,idx){const res=resources[url];const o={id:'n_ins'+(objects.length+1),name:'',objectType:(res&&res.type)||'image',resourceURL:url,x:pos.x,y:pos.y,scaleX:1,scaleY:1,rotation:0,alpha:1,visible:true,touchable:true,grayed:false,text:'',icon:'',GetProperty(p){return this[p];},SetProperty(p,v){this[p]=v;}};if(idx>=0&&idx<=objects.length)objects.splice(idx,0,o);else objects.push(o);return o;},
  RemoveObject(o){const i=objects.indexOf(o);if(i>=0)objects.splice(i,1);},
  Save(){if(saveMode==='throw')throw Error('disk full');if(saveMode==='dirty')return;if(saveMode!=='stale')files['fixture.xml']=serialize();this.isModified=false;}};
 let modified=false;
 // A closed document must not answer reads: it is how the suite proves the
 // implementation stopped touching the pre-close handle.
 Object.defineProperty(d,'isModified',{get(){if(d.dead)throw Error('已关闭的文档句柄');return modified;},set(v){if(d.dead)throw Error('已关闭的文档句柄');modified=v;}});
 return d;
}
function closeAndReload(){
 const victim=doc; victim.dead=true;
 reloadFromDisk();
}
function hexToColor(hex){
 const h=String(hex||'#ffffff').replace('#','');const n=i=>parseInt(h.substr(i*2,2),16)/255;
 return new Color(n(0),n(1),n(2),h.length>=8?n(3):1);
}
// Rebuilds the in-memory model from the on-disk XML, the way a real Editor
// reload does. A write that never reached disk therefore cannot appear here,
// which is exactly what the reload stage is supposed to detect.
function reloadFromDisk(){
 const parsed=parseXML(files['fixture.xml']);
 const list=parsed.children.find(n=>n.name==='displayList');
 objects=(list?list.children:[]).map(n=>{
  const a=n.attrs;
  const xy=(a.xy||'0,0').split(',').map(Number),size=(a.size||'0,0').split(',').map(Number);
  const scale=(a.scale||'1,1').split(',').map(Number);
  const o={id:a.id,name:a.name,x:xy[0],y:xy[1],width:size[0],height:size[1],scaleX:scale[0],scaleY:scale[1]??scale[0],rotation:Number(a.rotation||0),alpha:Number(a.alpha||1),visible:a.visible!=='false',touchable:a.touchable!=='false',grayed:a.grayed==='true',text:a.text??a.title??'',icon:a.icon||'',GetProperty(p){return this[p];},SetProperty(p,v){this[p]=v;}};
  if(n.name==='image'){o.objectType='image';o.resourceURL='ui://fixture0'+a.src;}
  if(n.name==='loader'){o.objectType='loader';o.url=a.url;}
  if(n.name==='text'){Object.assign(o,{objectType:'text',font:a.font||'',fontSize:Number(a.fontSize||0),color:hexToColor(a.color),align:a.align||'left',verticalAlign:a.vAlign||'top',leading:Number(a.leading||0),letterSpacing:Number(a.letterSpacing||0),autoSize:a.autoSize||'none'});}
  return o;
 });
 // Models an attribute the Editor silently drops when parsing: disk XML is
 // correct but the reloaded object is not. Only a real round-trip catches this.
 if(dropOnReload)for(const o of objects)if(o.id==='text1')o.fontSize=24;
}
// Mirrors FairyGUI's serializer: attributes still at their default are omitted
// from XML entirely. The previous version always wrote them, which let a
// default-valued assertion pass for the wrong reason.
const TEXT_DEFAULTS={font:'',fontSize:12,color:'#FFFFFF',align:'left',vAlign:'top',leading:0,letterSpacing:0,autoSize:'none'};
function omitDefaults(a){
 for(const [k,d] of Object.entries(TEXT_DEFAULTS)) if(a[k]===d||String(a[k])===String(d)) delete a[k];
 return a;
}
function serialize() {
 const esc=v=>String(v).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
 return '<component size="400,300"><displayList>'+objects.map(o=>{
 const a={id:o.id,name:o.name,xy:`${o.x},${o.y}`,size:`${o.width},${o.height}`};
 if(o.scaleX!==1||o.scaleY!==1)a.scale=`${o.scaleX},${o.scaleY}`;
 if(o.rotation)a.rotation=o.rotation;
 if(o.alpha!==1)a.alpha=o.alpha;
 if(o.visible===false)a.visible='false';
 if(o.touchable===false)a.touchable='false';
 if(o.grayed===true)a.grayed='true';
 if(o.text)a[o.objectType==='text'?'text':'title']=o.text;
 if(o.icon)a.icon=o.icon;
 if(o.objectType==='image')a.src=o.resourceURL.slice('ui://fixture0'.length);
 if(o.objectType==='loader')a.url=o.url;
 if(o.objectType==='text'){Object.assign(a,{font:o.font,fontSize:o.fontSize,color:ctx.colorHex(o.color),align:o.align,vAlign:o.verticalAlign,leading:o.leading,letterSpacing:o.letterSpacing,autoSize:o.autoSize});omitDefaults(a);}
 return `<${o.objectType} ${Object.entries(a).map(([k,v])=>`${k}="${esc(v)}"`).join(' ')}/>`;
 }).join('')+'</displayList></component>';
}
function test(name,run){try{setup();run();results.push({name,passed:true});}catch(e){results.push({name,passed:false,error:e.stack});}}
const replace=(id,extra={})=>ctx.replaceObjectResource({target:{id},resourceURL:'ui://fixture0blue',save:true,...extra});
const text=(extra={})=>ctx.setTextStyle({target:{id:'text1'},style:{fontSize:40,color:'#00ffBA',lineGap:8},save:true,...extra});
function rejects(fn,code,stage){assert.throws(fn,e=>(!code||e.code===code)&&(!stage||e.details?.stage===stage));}
test('Image replacement resolves new object and preserves ID/name/size',()=>{const old=objects[0];const r=replace('image1');assert.notEqual(old,objects[0]);assert.equal(r.persisted,true);assert.equal(r.after.width,64);assert.equal(r.verification.xml.resourceURL,'ui://fixture0blue');});
test('Loader remains Loader and URL is persisted',()=>{const r=replace('loader1');assert.equal(r.verification.xml.type,'loader');assert.equal(r.persisted,true);assert.equal(replaceCount,0);});
test('Text color/font size/line gap round trip',()=>{const r=text();assert.equal(r.persisted,true);assert.equal(r.after.lineGap,8);assert.equal(r.verification.xml.color,'#00FFBA');});
test('Unsaved writes never claim disk persistence',()=>{const r=text({save:false});assert.equal(r.saved,false);assert.equal(r.persisted,false);assert.equal(r.verification.xmlReadback,false);assert.equal(files['fixture.xml'],fixture);});
test('verify=false still checks Editor but never claims persistence',()=>{const r=replace('loader1',{verify:false});assert.equal(r.saved,true);assert.equal(r.persisted,false);assert.equal(r.verification.xmlReadback,false);});
test('Save throws',()=>{saveMode='throw';rejects(()=>text(),'persistence_failed','save');});
test('Save returns but remains dirty',()=>{saveMode='dirty';rejects(()=>text(),'persistence_failed','save');});
test('Save reports clean but stale XML fails with differences',()=>{saveMode='stale';assert.throws(()=>text(),e=>e.code==='persistence_failed'&&e.details.differences.some(d=>d.property==='fontSize'&&d.actual===24));});
test('Editor ignored replacement is not masked by input URL',()=>{replaceMode='ignore';rejects(()=>replace('image1'),'editor_rejected','editor');});
test('Invalid resource is rejected before mutation',()=>{assert.throws(()=>replace('image1',{resourceURL:'ui://missing'}));assert.equal(replaceCount,0);assert.equal(doc.isModified,false);});
test('Unsupported resource type rejected before mutation',()=>{resources['ui://fixture0blue'].type='font';rejects(()=>replace('image1'),'invalid_argument','input');assert.equal(replaceCount,0);});
test('Missing target rejected before save',()=>{assert.throws(()=>replace('missing'));assert.equal(files['fixture.xml'],fixture);});
test('Repeated Image replacement does not recreate objects',()=>{replace('image1');const disk=files['fixture.xml'];replace('image1');assert.equal(replaceCount,1);assert.equal(objects.length,3);assert.equal(files['fixture.xml'],disk);});
test('Read-only verify compares expected Editor and disk',()=>{const r=ctx.verifyDocument({target:{id:'text1'},expected:{fontSize:24,lineGap:4,color:'#ffffff'}});assert.equal(r.persisted,true);assert.equal(r.verification.externalReload,false);assert.equal(doc.isModified,false);});
test('Wrong expected value returns editor failure',()=>rejects(()=>ctx.verifyDocument({target:{id:'text1'},expected:{fontSize:99}}),'editor_rejected','editor'));
test('No expected value is a snapshot, not verification',()=>{const r=ctx.verifyDocument({});assert.equal(r.persisted,false);assert.equal(r.verification.editorReadback,false);});
test('Editor-only verification does not claim persistence',()=>{const r=ctx.verifyDocument({target:{id:'text1'},expected:{fontSize:24},readXml:false});assert.equal(r.persisted,false);});
test('Unknown property rejected before partial text mutation',()=>{rejects(()=>text({style:{fontSize:40,typo:8}}),'unsupported_property','input');assert.equal(objects[2].fontSize,24);});
test('Invalid text numeric type rejected before mutation',()=>{rejects(()=>text({style:{fontSize:'40'}}),'invalid_argument','input');assert.equal(objects[2].fontSize,24);});
test('Missing XML fails closed',()=>{delete files['fixture.xml'];rejects(()=>ctx.verifyDocument({target:{id:'text1'},expected:{fontSize:24}}),'persistence_failed','xml');});
test('Malformed XML fails closed',()=>{files['fixture.xml']='<broken';rejects(()=>ctx.verifyDocument({target:{id:'text1'},expected:{fontSize:24}}),'persistence_failed','xml');});
test('XML missing target fails closed',()=>{files['fixture.xml']='<component><displayList/></component>';rejects(()=>ctx.verifyDocument({target:{id:'text1'},expected:{fontSize:24}}),'persistence_failed','xml');});
test('External reload closes, reopens and re-locates the target',()=>{const r=text({externalReload:true});assert.equal(r.persisted,true);assert.equal(r.strength,'reload');assert.equal(r.verification.externalReload,true);assert.equal(r.verification.reload.performed,true);assert.equal(closeCount,1);assert.equal(r.verification.reload.values.fontSize,40);});
test('Asserting a default-valued property must not report a false persistence failure',()=>{const r=ctx.setTextStyle({target:{id:'text1'},style:{fontSize:40,color:'#FFFFFF',align:'left',vAlign:'top',lineGap:8},save:true});assert.equal(r.persisted,true);assert.equal(r.verification.xml.color,'#FFFFFF');assert.equal(r.verification.xml.align,'left');assert.equal(r.verification.xml.vAlign,'top');});
test('A non-default value stripped from XML must still fail closed',()=>{const r=ctx.setTextStyle({target:{id:'text1'},style:{fontSize:40,lineGap:8},save:true});files['fixture.xml']=files['fixture.xml'].replace('fontSize="40"','fontSize="12"');assert.throws(()=>ctx.verifyDocument({target:{id:'text1'},expected:{fontSize:40}}),e=>e.code==='persistence_failed'&&e.details.stage==='xml');assert.equal(r.strength,'disk');});
test('Missing XML attributes resolve to FairyGUI defaults, not null',()=>{const r=ctx.verifyDocument({target:{id:'text1'},expected:{fontSize:24,align:'center',letterSpacing:1,color:'#FFFFFF',autoSize:'none'}});assert.equal(r.persisted,true);assert.equal(r.verification.xml.color,'#FFFFFF');assert.equal(r.verification.xml.autoSize,'none');assert.equal(r.verification.xml.align,'center');});
test('Reload result is read from the reopened document, not the closed handle',()=>{const before=doc;const r=text({externalReload:true});assert.equal(before.dead,true);assert.notEqual(doc,before);assert.equal(r.documentModified,false);});
test('Without externalReload the write stays at disk strength',()=>{const r=text();assert.equal(r.strength,'disk');assert.equal(r.verification.externalReload,false);assert.equal(closeCount,0);assert.equal(r.persisted,true);});
test('Reload without save is rejected before any mutation',()=>{rejects(()=>text({save:false,externalReload:true}),'invalid_argument','input');assert.equal(closeCount,0);assert.equal(objects[2].fontSize,24);assert.equal(doc.isModified,false);});
test('Reload with verify:false is rejected before any mutation',()=>{rejects(()=>text({verify:false,externalReload:true}),'invalid_argument','input');assert.equal(closeCount,0);assert.equal(objects[2].fontSize,24);});
test('Reload falls back to the singular close overload and reports which was used',()=>{closeMode='plural-throw';const r=text({externalReload:true});assert.equal(r.verification.reload.closeStrategy,'CloseDocument');assert.deepEqual(closeUsed,['CloseDocument']);assert.equal(r.persisted,true);});
test('Reload fails when no close overload survives',()=>{closeMode='none';rejects(()=>text({externalReload:true}),'persistence_failed','reload');});
test('Reload fails when the document cannot be reopened',()=>{openMode='null';rejects(()=>text({externalReload:true}),'persistence_failed','reload');});
test('Reload catches a value the Editor drops on load even though disk XML matches',()=>{dropOnReload=true;assert.throws(()=>text({externalReload:true}),e=>e.code==='persistence_failed'&&e.details.stage==='reload'&&e.details.differences.some(d=>d.property==='fontSize'&&d.actual===24));});
test('The dropped-on-load case passes disk readback, proving reload adds coverage',()=>{dropOnReload=true;const r=text();assert.equal(r.verification.xmlReadback,true);assert.equal(r.verification.xml.fontSize,40);assert.equal(r.strength,'disk');});
test('verifyDocument can reload an already saved document without saving',()=>{const r=ctx.verifyDocument({target:{id:'text1'},expected:{fontSize:24,lineGap:4},externalReload:true});assert.equal(r.strength,'reload');assert.equal(r.persisted,true);assert.equal(r.saved,true);assert.equal(closeCount,1);});
test('verifyDocument refuses to close a document with unsaved changes',()=>{doc.SetModified(true);rejects(()=>ctx.verifyDocument({target:{id:'text1'},expected:{fontSize:24},externalReload:true}),'invalid_argument','reload');assert.equal(closeCount,0);});
test('Snapshot mode never closes the document even if asked',()=>{const r=ctx.verifyDocument({});assert.equal(closeCount,0);assert.equal(r.strength,'none');assert.equal(r.persisted,false);});
test('Button state API cannot silently replace whole button',()=>{objects[0].objectType='button';rejects(()=>replace('image1',{state:'up'}),'unsupported_property','input');assert.equal(replaceCount,0);});
const set=(id,property,value,extra={})=>ctx.handleCommand({action:'set_property',params:{target:{id},property,value,save:true,...extra}});
const insert=(extra={})=>ctx.handleCommand({action:'insert_object',params:{url:'ui://fixture0red',x:5,y:6,name:'inserted',save:true,...extra}});
const remove=(id,extra={})=>ctx.handleCommand({action:'remove_object',params:{target:{id},save:true,...extra}});
test('set_property persists a numeric property through save and disk readback',()=>{const r=set('text1','x',42);assert.equal(r.ok,true);assert.equal(r.persisted,true);assert.equal(r.strength,'disk');assert.equal(r.after,42);assert.equal(r.verification.xml.x,42);assert.equal(r.history.agentUndoCount,1);});
test('set_property verifies boolean defaults in both directions',()=>{const r=set('image1','visible',false);assert.equal(r.persisted,true);assert.equal(r.verification.xml.visible,false);const r2=set('image1','visible',true);assert.equal(r2.persisted,true);assert.equal(r2.verification.xml.visible,true);});
test('set_property without save never claims persistence',()=>{const r=set('text1','x',7,{save:false});assert.equal(r.saved,false);assert.equal(r.persisted,false);assert.equal(r.strength,'none');assert.equal(files['fixture.xml'],fixture);});
test('set_property rejects non-whitelist property before mutation',()=>{rejects(()=>set('text1','evil',1),'unsupported_property','input');assert.equal(objects[2].x,0);});
test('set_property rejects invalid numeric before mutation',()=>{rejects(()=>set('text1','x','abc'),'invalid_argument','input');assert.equal(objects[2].x,0);});
test('set_property external reload round-trips the value',()=>{const r=set('text1','scaleX',1.5,{externalReload:true});assert.equal(r.strength,'reload');assert.equal(r.verification.reload.values.scaleX,1.5);assert.equal(closeCount,1);});
test('insert_object saves and reads the new node back from XML',()=>{const r=insert();assert.equal(r.persisted,true);assert.equal(r.strength,'disk');assert.equal(r.verification.xml.name,'inserted');assert.equal(r.verification.xml.resourceURL,'ui://fixture0red');assert.equal(r.verification.xml.x,5);assert.equal(objects.length,4);});
test('insert_object rejects reload without save before inserting',()=>{rejects(()=>insert({save:false,externalReload:true}),'invalid_argument','input');assert.equal(objects.length,3);});
test('remove_object verifies absence on disk after save',()=>{const r=remove('loader1');assert.equal(r.persisted,true);assert.equal(r.verification.xmlReadback,true);assert.equal(objects.length,2);assert.ok(!files['fixture.xml'].includes('loader1'));});
test('remove_object external reload proves the node stays gone',()=>{const r=remove('loader1',{externalReload:true});assert.equal(r.strength,'reload');assert.equal(r.verification.reload.absent,true);assert.equal(closeCount,1);});
test('remove_object without save does not claim persistence',()=>{const r=remove('loader1',{save:false});assert.equal(r.saved,false);assert.equal(r.persisted,false);assert.equal(files['fixture.xml'],fixture);});
test('remove_object fails closed when the disk write is stale',()=>{saveMode='stale';rejects(()=>remove('loader1'),'persistence_failed','xml');});
// externalReloadVerified stays false on purpose: this suite proves the reload
// verification *logic* against a mocked host, never Editor acceptance.
const report={schemaVersion:1,suite:'p0-persistence-host',evidence:'mocked-editor-host',liveEditorVerified:false,mockedExternalReloadCovered:true,externalReloadVerified:false,passed:results.filter(r=>r.passed).length,total:results.length,cases:results};
const output=JSON.stringify(report,null,2)+'\n';
if(process.argv[2]==='--report'&&process.argv[3])fs.writeFileSync(process.argv[3],output);
process.stdout.write(output);if(results.some(r=>!r.passed))process.exitCode=1;
