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
function setup() {
 files={'fixture.xml':fixture};saveMode='normal';replaceMode='normal';replaceCount=0;
 const resource=(id,w=64,h=64)=>({id,owner:{id:'fixture0'},type:'image',width:w,height:h,GetURL:()=>`ui://fixture0${id}`});
 resources={'ui://fixture0red':resource('red'),'ui://fixture0blue':resource('blue',128,128)};
 objects=[{id:'image1',name:'picture',objectType:'image',resourceURL:'ui://fixture0red',width:64,height:64,x:10,y:20}, {id:'loader1',name:'icon',objectType:'loader',url:'ui://fixture0red',width:64,height:64,x:80,y:20}, {id:'text1',name:'title',objectType:'text',font:'',fontSize:24,color:new Color(1,1,1,1),align:'center',verticalAlign:'middle',leading:4,letterSpacing:1,autoSize:'none',width:240,height:60,x:0,y:100}];
 doc={content:{resourceURL:'ui://fixture0component'},isModified:false,SetModified(v){this.isModified=v;},RefreshInspectors(){},SetSelection(o){this.selected=o;},ReplaceSelection(url){replaceCount++;if(replaceMode==='ignore')return;const i=objects.indexOf(this.selected);objects[i]={...this.selected,resourceURL:url};},Save(){if(saveMode==='throw')throw Error('disk full');if(saveMode==='dirty')return;if(saveMode!=='stale')files['fixture.xml']=serialize();this.isModified=false;}};
 resources['ui://fixture0component']={file:'fixture.xml',owner:{id:'fixture0'}};
 const app={project:{GetItemByURL:url=>resources[url] || null}};
 ctx=vm.createContext({exports:{},CS:{FairyEditor:{App:app,FPackageItemType:{IMAGE:'image',FONT:'font'}},UnityEngine:{Application:{runInBackground:false},Color},System:{IO:{File:{Exists:p=>p in files,ReadAllText:p=>files[p]},Directory:{},Path:{},FileInfo:{},SearchOption:{}}},FairyGUI:{Utils:{XML}}},require:()=>({}),console});
 const code=fs.readFileSync(path.join(root,'plugin/main.js'),'utf8').split('App.add_onUpdate(onUpdate);')[0];
 vm.runInContext(code,ctx);
 ctx.getActiveDocument=()=>doc;
 ctx.resolveObject=(_,t)=>{const o=objects.find(o=>o.id===t.id);if(!o)throw Error('未找到对象 ID');return o;};
 ctx.describeObject=o=>({id:o.id});ctx.describeDocument=()=>({modified:doc.isModified});
}
function serialize() {
 const esc=v=>String(v).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
 return '<component size="400,300"><displayList>'+objects.map(o=>{
 const a={id:o.id,name:o.name,xy:`${o.x},${o.y}`,size:`${o.width},${o.height}`};
 if(o.objectType==='image')a.src=o.resourceURL.slice('ui://fixture0'.length);
 if(o.objectType==='loader')a.url=o.url;
 if(o.objectType==='text')Object.assign(a,{font:o.font,fontSize:o.fontSize,color:ctx.colorHex(o.color),align:o.align,vAlign:o.verticalAlign,leading:o.leading,letterSpacing:o.letterSpacing,autoSize:o.autoSize});
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
test('External reload is explicitly unsupported',()=>rejects(()=>text({externalReload:true}),'unsupported_property','input'));
test('Button state API cannot silently replace whole button',()=>{objects[0].objectType='button';rejects(()=>replace('image1',{state:'up'}),'unsupported_property','input');assert.equal(replaceCount,0);});
const report={schemaVersion:1,suite:'p0-persistence-host',evidence:'mocked-editor-host',liveEditorVerified:false,externalReloadVerified:false,passed:results.filter(r=>r.passed).length,total:results.length,cases:results};
const output=JSON.stringify(report,null,2)+'\n';
if(process.argv[2]==='--report'&&process.argv[3])fs.writeFileSync(process.argv[3],output);
process.stdout.write(output);if(results.some(r=>!r.passed))process.exitCode=1;
