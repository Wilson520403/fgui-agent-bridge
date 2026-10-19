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
  constructor(text) { this.data = typeof text === 'string' ? parseXML(text) : text; this.name=this.data.name;
  // 真机上 XML.attributes 是 C# Dictionary：JSON.stringify 得 {}，只能靠
  // GetEnumerator/MoveNext/Current 取。夹具不建这个面，xmlAttributes() 会按设计
  // 返回空字典，磁盘层断言就会「以零字段通过」——那比失败更糟。
  const self=this; const keys=Object.keys(this.data.attrs||{});
  this.attributes={get Count(){return keys.length;},
   GetEnumerator(){let i=0;return {MoveNext(){if(i>=keys.length)return false;i++;return true;},get Current(){return {key:keys[i-1],value:self.data.attrs[keys[i-1]]};}};}};
  }
  GetAttribute(k) { return this.data.attrs[k] ?? null; }
  GetNode(k) { const n=this.data.children.find(n=>n.name===k);return n ? new XML(n):null; }
  get elements() { const a=this.data.children;return {Count:a.length,get_Item:i=>new XML(a[i])}; }
}
function Color(r,g,b,a) { Object.assign(this,{r,g,b,a}); }
const results=[];
const tests=[];
let ctx,doc,objects,files,resources,saveMode,replaceMode,replaceCount;
let closeMode,openMode,dropOnReload,closeCount,closeUsed;
let transitions,packageItems,pkg,pkgSaveMode,dropTransitionOnReload;
let controllers,refRegistry,depRegistry;
let globalSettings;
// 原生 ReplaceReferences 的调用轨迹：写侧用例要钉住「只调一次」「调的是本实例
// 查出来的那批」，否则「预览复用旧列表」这类错误在测试里看不出来。
let replaceCallCount,lastReplace;
// 真机实测：ReferenceInfo.content 是 FairyGUI.Utils.XML 元素节点，其 attributes
// 是 C# 字典（JSON.stringify 得 {}），只能靠 GetEnumerator/MoveNext/Current 取。
// 夹具照这个形态建模，否则测试会通过一个真实环境不存在的假象。
function makeXmlNode(tag,attributes){
 const pairs=Object.entries(attributes);
 let index=0;
 return {name:tag,text:'',__pairs:pairs,
  attributes:{
   get Count(){return pairs.length},
   GetEnumerator(){return {MoveNext(){if(index>=pairs.length)return false;index++;return true;},get Current(){const [k,v]=pairs[index-1];return {key:k,value:v};}};},
   GetAttribute(k){const hit=pairs.find(p=>p[0]===k);return hit?hit[1]:null;}
  }};
}
function makeDependencyQuery(){
 return {
  resultList:{Count:0,get_Item:()=>null},
  references:{Count:0,get_Item:()=>null},
  _stagedUrl:null,
  QueryReferences(project,url){
   const refs=refRegistry[url]||[];
   this._stagedUrl=url;
   this.references={Count:refs.length,get_Item:i=>Object.assign({ownerPkg:pkg,pkgId:pkg.id},refs[i])};
  },
  QueryDependencies(project,url,level){
   const entry=depRegistry[url];
   const list=(entry&&entry[level])||[];
   this.resultList={Count:list.length,get_Item:i=>list[i]};
  },
  // 真机 6.1.4 实测的语义，不是按签名想象的：
  //  · 只收新资源，old 来自本实例上 QueryReferences 已经查出来的那一批；
  //  · 没有查过就调用会抛错（跨请求复用实例时最该被抓住的那种错）；
  //  · 改的是 src/url 本身，image 的 fileName 故意不跟着改——这正是原生批量
  //    替换留下的半状态，模拟宿主不修它，测试才钉得住「验证不能宣称属性级一致」。
  ReplaceReferences(newItem){
   if(!this._stagedUrl)throw Error('ReplaceReferences without a staged QueryReferences on this instance');
   replaceCallCount++;
   const from=this._stagedUrl;
   const staged=refRegistry[from]||[];
   if(!staged.length)return;
   const target=newItem.GetURL();
   const kept=(refRegistry[target]||[]).slice();
   const value=Number(newItem.valueTypeHint||0)===1?target:newItem.id;
   const moved=staged.map(ref=>{
    const next={};
    ref.content.__pairs.forEach(([k,v])=>{next[k]=k===ref.propKey?value:v;});
    return Object.assign({},ref,{content:makeXmlNode(ref.content.name,next)});
   });
   refRegistry[from]=[];
   refRegistry[target]=kept.concat(moved);
   lastReplace={from,to:target,movedCount:moved.length};
  }
 };
}
function makeTransitionItem(targetId,type,frame){
 const it={targetId,type,frame,label:'',tween:false,easeType:'Quad',repeat:0,yoyo:false,usePath:false,pathData:'',customEaseData:'',value:{f1:0,f2:0,b1:true,b2:true,b3:false,i:0,s:'',s2:'',iu:null},prevItem:null,nextItem:null,_path:[],
  pathPoints:{get Count(){return it._path.length},get_Item:i=>it._path[i],set_Item(i,v){it._path[i]=v;}},
  AddPathPoint(x,y,near){it._path.push({pos:{x,y},curveType:'straight',smooth:false});},
  UpdateControlPoint(){},
  customEase:{points:{Clear(){},Add(){}},Update(){}}};
 return it;
}
function relinkTransitionItems(items){items.forEach((it,i)=>{it.prevItem=i>0?items[i-1]:null;it.nextItem=i<items.length-1?items[i+1]:null;});}
function makeTransition(name){
 const items=[];
 const t={name,options:0,autoPlay:false,autoPlayDelay:0,autoPlayRepeat:1,frameRate:60,playTimes:1,playing:false,_items:items,
  get maxFrame(){return items.length?Math.max(...items.map(i=>i.frame)):0;},
  items:{get Count(){return items.length},get_Item:i=>items[i]},
  CreateItem(targetId,type,frame){const it=makeTransitionItem(targetId,type,frame);items.push(it);items.sort((a,b)=>a.frame-b.frame);relinkTransitionItems(items);return it;},
  DeleteItem(it){const i=items.indexOf(it);if(i>=0)items.splice(i,1);relinkTransitionItems(items);},
  Validate(){}};
 return t;
}
function makeTransitionsCollection(list){
 return {
  items:{get Count(){return list.length},get_Item:i=>list[i]},
  GetItem:name=>list.find(t=>t.name===name)||null,
  AddItem(name){const t=makeTransition(name);list.push(t);return t;},
  RemoveItem(t){const i=list.indexOf(t);if(i>=0)list.splice(i,1);},
  Write(){return {ToXMLString:()=>'<transitions>'+serializeTransitions()+'</transitions>'};}
 };
}
// Mirrors the Editor serializer: a tween start+end pair folds into one <item>
// with startValue/endValue/duration, so the public item count matches the XML.
function serializeTransitions(){
 return transitions.map(t=>{
  const its=t._items.filter(it=>!(it.prevItem&&it.prevItem.tween&&!it.tween)).map(it=>{
   const a={time:it.frame,type:it.type,target:it.targetId};
   if(it.tween){a.tween='true';a.startValue=it.value.f1;a.endValue=it.nextItem.value.f1;a.duration=it.nextItem.frame-it.frame;}
   else a.startValue=it.value.f1;
   return `<item ${Object.entries(a).map(([k,v])=>`${k}="${v}"`).join(' ')}/>`;
  }).join('');
  return `<transition name="${t.name}" frameRate="${t.frameRate}">${its}</transition>`;
 }).join('');
}
function rebuildTransitionFromXml(node){
 const t=makeTransition(node.GetAttribute('name'));
 const frameRate=node.GetAttribute('frameRate');if(frameRate!==null)t.frameRate=Number(frameRate);
 for(let i=0;i<node.elements.Count;i++){
  const c=node.elements.get_Item(i);
  if(c.name!=='item')continue;
  const it=t.CreateItem(c.GetAttribute('target'),c.GetAttribute('type'),Number(c.GetAttribute('time')||0));
  it.value.f1=Number(c.GetAttribute('startValue')||0);
  if(c.GetAttribute('tween')==='true'){it.tween=true;const end=t.CreateItem(c.GetAttribute('target'),c.GetAttribute('type'),Number(c.GetAttribute('time')||0)+Number(c.GetAttribute('duration')||0));end.value.f1=Number(c.GetAttribute('endValue')||0);}
 }
 return t;
}
function flushFolderAtlasToDisk(){
 // 真机 6.1.4：folderAtlas 写进内存后随保存落进 package.xml，但**不读回内存**。
 // 夹具把这条链补齐——保存时把内存值并入磁盘镜像 _persistedAtlas，再把内存值清空。
 // 不建模这一步的话，「磁盘口径的幂等守卫」会在测试里通过一个真机不存在的假象：
 // 只要磁盘镜像永远是空，任何写盘动作都像是在重复施加。
 for(const it of packageItems){
  if(it.type!=='image')continue;
  const v=String(it.folderAtlas||'');
  if(v){it._persistedAtlas=v;it.folderAtlas='';}
 }
}
function serializePackageXml(){
 // 真机实测：<image atlas="alone"> 会写进 package.xml 并在后续保存中保留，
 // 但 FPackageItem.folderAtlas 重启后不读回。夹具照这个形态建模——atlas 属性
 // 从一个独立的 _persistedAtlas 读，不从内存 folderAtlas 读，否则
 // analyze_atlas_fit 的磁盘口径会在测试里通过一个真机不存在的假象。
 //
 // <publish> 的属性编码**尚未在真机上钉死**（6.1.4 的 package.xml 里它是空的
 // `<publish name=""/>`）。这里用一种平铺的占位编码，测试只断言「内存写入 →
 // 磁盘 → 重开回读」这条往返链自洽，不断言任何具体属性名——真机确认真实编码后
 // 再把 encodePublishXml 换成真实格式，那时才有资格加属性级断言。
 const ps=pkg.publishSettings;
 const attrs=encodePublishXml(ps);
 return `<packageDescription id="${pkg.id}"><resources>${packageItems.map(i=>`<${i.type} id="${i.id}" name="${i.name}" path="/" exported="${i.exported}"${i._persistedAtlas?` atlas="${i._persistedAtlas}"`:''}/>`).join('')}</resources><publish ${attrs}/></packageDescription>`;
}
function encodePublishXml(ps){
 const pairs=[];
 if(ps.path)pairs.push(`path="${ps.path}"`);
 if(ps.genCode)pairs.push('genCode="true"');
 if(ps.codePath)pairs.push(`codePath="${ps.codePath}"`);
 if(ps.branchPath)pairs.push(`branchPath="${ps.branchPath}"`);
 if(ps.useGlobalAtlasSettings===false)pairs.push('useGlobalAtlasSettings="false"');
 if(ps.excludedList.Count)pairs.push(`excluded="${listValues(ps.excludedList).join(',')}"`);
 const atlasValues=[];
 for(let i=0;i<ps.atlasList.Count;i++){
  const a=ps.atlasList.get_Item(i);
  atlasValues.push(`${a.name}:${a.packSettings.maxWidth}x${a.packSettings.maxHeight}:pad${a.packSettings.padding}${a.packSettings.rotation?':rot':''}${a.packSettings.square?':sq':''}`);
 }
 // 多个图集编码进**同一个**属性值：XML 属性名唯一，重复写 atlas= 会被后一个覆盖，
 // 那样 reload 用例就会拿着半个 atlasList 通过。
 if(atlasValues.length)pairs.push(`atlas="${atlasValues.join('|')}"`);
 return pairs.join(' ');
}
function listValues(list){const out=[];for(let i=0;i<list.Count;i++)out.push(String(list.get_Item(i)));return out;}
// 模拟「重开包 = 从 package.xml 重建内存设置」。这正是 folderAtlas 不读回的
// 同一个机制在包设置上的对应物：磁盘是唯一真相，内存必须重新解析。
function decodePublishXml(attrs){
 const ps=makePackagePublishSettings();
 if(attrs.path)ps.path=attrs.path;
 if(attrs.genCode==='true')ps.genCode=true;
 if(attrs.codePath)ps.codePath=attrs.codePath;
 if(attrs.branchPath)ps.branchPath=attrs.branchPath;
 if(attrs.useGlobalAtlasSettings==='false')ps.useGlobalAtlasSettings=false;
 if(attrs.excluded)ps.excludedList=makeCSharpList(attrs.excluded.split(','));
 for(const raw of (attrs.atlas?String(attrs.atlas).split('|'):[])){
  if(!raw)continue;
  const [name,size,flags]=raw.split(':');
  const [w,h]=String(size).split('x');
  // flags 自身也可能带 ':'（pad10:rot），所以按整段 raw 判别，别只看 flags——
  // 否则 rotation/square 会静默丢掉，reload 用例拿着半个配置通过。
  ps.atlasList.Add(makeAtlasSettings(name,{maxWidth:Number(w)||0,maxHeight:Number(h)||0,
   padding:Number(String(flags).replace(/[^0-9]/g,''))||0,
   rotation:raw.indexOf(':rot')>=0,square:raw.indexOf(':sq')>=0}));
 }
 return ps;
}
function reopenPackageFromDisk(){
 const xml=new XML(String(files['/pkg/package.xml']));
 const node=xml.GetNode('publish');
 const attrs={};
 if(node){
  const pairs=[['path'],['genCode'],['codePath'],['branchPath'],['useGlobalAtlasSettings'],['excluded'],['atlas']];
  for(const [k] of pairs){const v=node.GetAttribute(k);if(v!==null)attrs[k]=v;}
 }
 const reopened=makePackage();
 reopened.publishSettings=decodePublishXml(attrs);
 reopened.isReopened=true;
 return reopened;
}
function makePackageItem(name,type,ext){
 const id='it'+(packageItems.length+1);
 const file=`/pkg/${name}${ext}`;
 const it={id,name:`${name}${ext}`,type,title:name,path:'/',file,width:64,height:64,exported:true,folderAtlas:'',_asset:null,_atlasIndex:0,supportAtlas:type==='image',
  GetURL:()=>`ui://${pkg.id}${id}`,
  GetAtlasIndex(){return it._atlasIndex;},
  SetChanged(){},EnsureOpen(){},
  UnloadAsset(){it._asset=null;},
  GetAsset(){if(!(it.file in files))return null;it._asset=it._asset||{file:it.file};return it._asset;},
  UnloadAssetLabel:1};
 it.owner=pkg;
 packageItems.push(it);
 resources[it.GetURL()]=it;
 return it;
}
// 发布设置夹具。字段名照 6.1.4 真实声明（GlobalPublishSettings / PublishSettings /
// AtlasSettings / PackSettings），形状不同是真实的：全局只有 AtlasSetting
// (maxSize/forceSquare/allowRotation)，包级才有 packSettings (padding/maxWidth/
// square/rotation/...)。两套形状都必须能归一化，否则「按真实约束判断」只是换名字的猜测。
function makePackSettings(over){
 const base={pot:false,mof:false,padding:0,rotation:false,minWidth:0,minHeight:0,
  maxWidth:2048,maxHeight:2048,square:false,fast:false,edgePadding:false,duplicatePadding:false,multiPage:true};
 return Object.assign(base,over||{});
}
function makeAtlasSettings(name,over){
 // 真机实测（Editor 6.1.4）：AtlasSettings.packSettings 在声明里是 public 字段，
 // 运行时却是**只读属性**，赋值抛 "Cannot assign to read only property"。
 // 夹具必须照这个形态建模，否则「替换整个 packSettings 对象」这种写法在测试里
 // 会一路绿灯，直到真机才炸。
 const pack=makePackSettings(over);
 return {name:name||'Main',compression:true,extractAlpha:true,
  get packSettings(){return pack;},
  set packSettings(v){throw new TypeError("Cannot assign to read only property 'packSettings' of object '[object Object]'");}};
}
// C# List<T> 的可用面：读用 Count/get_Item，写侧用 Clear/Add。真机上包级设置的
// atlasList / excludedList 就是这种可写 List（FPackage.publishSettings 是只读
// getter，字段本身可写），夹具不建成真数组，否则写路径会在测试里通过一个
// 真实环境不存在的假象。
function makeCSharpList(initial){
 const items=[];if(initial)initial.forEach(v=>items.push(v));
 return {get Count(){return items.length;},get_Item:i=>items[i],Clear(){items.length=0;},Add(v){items.push(v);return items.length-1;},_items:items};
}
function makePackagePublishSettings(over){
 return Object.assign({path:'',fileName:'',packageCount:2,genCode:false,codePath:'',branchPath:'',
  useGlobalAtlasSettings:true,atlasList:makeCSharpList(),excludedList:makeCSharpList()},over||{});
}
function makeGlobalPublishSettings(){
 return {path:'',branchPath:'',fileExtension:'bytes',packageCount:2,compressDesc:true,binaryFormat:true,
  jpegQuality:80,compressPNG:false,includeHighResolution:0,branchProcessing:0,seperatedAtlasForBranch:false,
  codeGeneration:{allowGenCode:true,codePath:'',classNamePrefix:'UI_',memberNamePrefix:'m_',packageName:null,
   ignoreNoname:true,getMemberByName:false,codeType:''},
  // 与 sample 工程真机读数一致（tests/reports 里的 get_publish_settings 证据）
  atlasSetting:{maxSize:2048,paging:true,sizeOption:'pot',forceSquare:false,allowRotation:false,trimImage:true}};
}
function makePackage(){
 const items=[];
 return {
  id:'fixture0',name:'Fixture',basePath:'/pkg',opened:true,_items:items,
  publishSettings:makePackagePublishSettings(),
  // The real FPackage.items enumerates the package's own resources; the previous
  // stub kept a private array nothing was ever pushed to, so it always reported
  // zero items. analyze_atlas_fit walks items directly and would silently judge
  // nothing under that stub.
  get items(){const own=packageItems.filter(i=>!i.owner||i.owner===this);return {Count:own.length,get_Item:i=>own[i]};},
  rootItem:{type:'folder',path:'/'},
  EnsureOpen(){this.opened=true;},SetChanged(){this.changed=true;},
  Dispose(){this.disposed=true;},
  Save(){if(pkgSaveMode==='throw')throw Error('disk full');if(pkgSaveMode==='stale')return;flushFolderAtlasToDisk();files['/pkg/package.xml']=serializePackageXml();this.changed=false;},
  GetItemByPath(p){return p==='/'?this.rootItem:null;},
  EnsurePathExists(p){return this.rootItem;},
  GetItemByName(folder,name){return packageItems.find(i=>(i.name===name||i.name===`${name}.png`||i.name===`${name}.xml`||i.name===`${name}.jta`)&&i.path===folder.path)||null;},
  GetItem(id){return packageItems.find(i=>i.id===id)||null;},
  CreateComponentItem(name,w,h,folderPath,extensionId,exported){const it=makePackageItem(name,'component','.xml');it.exported=exported;files[it.file]='<component/>';return it;},
  ImportResource(sourcePath,folderPath,fileName){const it=makePackageItem(fileName.replace(/\.[^.]+$/,''),'image',fileName.slice(fileName.lastIndexOf('.')));files[it.file]=files[sourcePath];return it;},
  UpdateResource(item,sourcePath){files[item.file]=files[sourcePath];return item;},
  CreateMovieClipItem(name,folderPath){const it=makePackageItem(name,'movieclip','.jta');return it;},
  DeleteItem(item){const i=packageItems.indexOf(item);if(i>=0)packageItems.splice(i,1);delete resources[item.GetURL()];delete files[item.file];}
 };
}
// The inner child of the comp1 fixture component; rebuilt on reload so the
// reopened document keeps modelling a nested component's content.
function makeInner(){
 return {id:'inner1',name:'innerLabel',objectType:'text',font:'',fontSize:12,color:new Color(1,1,1,1),align:'left',verticalAlign:'top',leading:0,letterSpacing:0,autoSize:'none',width:50,height:20,x:0,y:0,scaleX:1,scaleY:1,rotation:0,alpha:1,visible:true,touchable:true,grayed:false,text:'',icon:'',GetProperty(p){return this[p];},SetProperty(p,v){this[p]=v;}};
}
function makeController(name,pageNames){
 const pages=pageNames.map((n,i)=>({id:String(i),name:n}));
 const c={name,_selectedIndex:0,exported:false,autoRadioGroupDepth:false,homePage:'',alias:'',homePageType:'common',parent:null,changing:false,
  get selectedIndex(){return c._selectedIndex;},set selectedIndex(v){c._selectedIndex=v;},
  get selectedPage(){return pages[c._selectedIndex]?pages[c._selectedIndex].name:'';},
  set selectedPage(n){const i=pages.findIndex(p=>p.name===n);if(i>=0)c._selectedIndex=i;},
  get selectedPageId(){return pages[c._selectedIndex]?pages[c._selectedIndex].id:'';},
  get pageCount(){return pages.length;},
  _pages:pages,
  GetPages(){return {Count:pages.length,get_Item:i=>pages[i]};},
  GetPageIds(){return {Count:pages.length,get_Item:i=>pages[i].id};},
  GetPageNames(){return {Count:pages.length,get_Item:i=>pages[i].name};},
  HasPageId:v=>pages.some(p=>p.id===String(v)),
  HasPageName:v=>pages.some(p=>p.name===String(v)),
  AddPage(n){pages.push({id:String(pages.length),name:String(n)});return pages[pages.length-1];},
  AddPageAt(n,i){const p={id:String(pages.length),name:String(n)};pages.splice(i,0,p);return p;},
  RemovePageAt(i){pages.splice(i,1);},
  SetPages(names){pages.length=0;names.forEach((n,i)=>pages.push({id:String(i),name:String(n)}));},
  SetSelectedIndex(i){c._selectedIndex=i;}};
 return c;
}
function makeRelations(){
 const r={_items:[],
  get items(){return {Count:r._items.length,get_Item:i=>r._items[i]}},
  get isEmpty(){return r._items.length===0;},
  AddItem(t,sp){const it={owner:null,target:t,sidePair:String(sp||''),desc:String(sp||'')};r._items.push(it);return it;},
  RemoveItem(it){const i=r._items.indexOf(it);if(i>=0)r._items.splice(i,1);},
  RemoveTarget(t){r._items=r._items.filter(i=>i.target!==t);},
  GetItem(t){return r._items.find(i=>i.target===t)||null;},
  HasTarget(t){return r._items.some(i=>i.target===t);},
  Reset(){r._items.length=0;},
  Write(){return new XML({name:'relations',attrs:{},children:r._items.map(i=>({name:'relation',attrs:{target:i.target?String(i.target.id||''):'',sidePair:i.sidePair},children:[]}))});}};
 return r;
}
function attachLayoutMembers(o){
 o.relations=makeRelations();
 o._gears=[];
 o.GetGear=(i,create)=>{if(!o._gears[i]&&create)o._gears[i]={controller:null,pages:[]};return o._gears[i]||null;};
 o.CheckGearDisplay=()=>{};
}
function setup() {
 files={'fixture.xml':fixture};saveMode='normal';replaceMode='normal';replaceCount=0;
 closeMode='normal';openMode='normal';dropOnReload=false;closeCount=0;closeUsed=[];
 transitions=[];packageItems=[];pkgSaveMode='normal';dropTransitionOnReload=false;
 replaceCallCount=0;lastReplace=null;
 controllers=[makeController('c1',['page0','page1'])];
 globalSettings=makeGlobalPublishSettings();
 pkg=makePackage();
 const resource=(id,w=64,h=64)=>({id,owner:{id:'fixture0'},type:'image',width:w,height:h,GetURL:()=>`ui://fixture0${id}`});
 resources={'ui://fixture0red':resource('red'),'ui://fixture0blue':resource('blue',128,128)};
 resources['ui://fixture0panel']={id:'panel',owner:{id:'fixture0'},type:'component',width:100,height:50,GetURL:()=>'ui://fixture0panel'};
 objects=[{id:'image1',name:'picture',objectType:'image',resourceURL:'ui://fixture0red',width:64,height:64,x:10,y:20}, {id:'loader1',name:'icon',objectType:'loader',url:'ui://fixture0red',width:64,height:64,x:80,y:20}, {id:'text1',name:'title',objectType:'text',font:'',fontSize:24,color:new Color(1,1,1,1),align:'center',verticalAlign:'middle',leading:4,letterSpacing:1,autoSize:'none',width:240,height:60,x:0,y:100}];
 for(const o of objects)Object.assign(o,{scaleX:1,scaleY:1,rotation:0,alpha:1,visible:true,touchable:true,grayed:false,text:'',icon:'',GetProperty(p){return this[p];},SetProperty(p,v){this[p]=v;}});
 objects.forEach(attachLayoutMembers);
 // A nested component child: its own serialized file is out of scope for this
 // document's XML stage, which is exactly what the tree verification must skip.
 objects.push({id:'comp1',name:'panel',objectType:'component',resourceURL:'ui://fixture0panel',width:100,height:50,x:200,y:200,scaleX:1,scaleY:1,rotation:0,alpha:1,visible:true,touchable:true,grayed:false,text:'',icon:'',GetProperty(p){return this[p];},SetProperty(p,v){this[p]=v;},get numChildren(){return 1},GetChildAt:()=>makeInner()});
 attachLayoutMembers(objects[objects.length-1]);
 doc=makeDoc();
 resources['ui://fixture0component']={file:'fixture.xml',owner:{id:'fixture0'}};
 const mc={id:'mc1',name:'loop.jta',type:'movieclip',title:'loop',path:'/',file:'/pkg/mc.jta',width:64,height:64,exported:true,folderAtlas:'',owner:pkg,
  GetURL:()=>'ui://fixture0mc1',SetChanged(){},UnloadAsset(){mc._asset=null;},GetAsset(){if(!(mc.file in files))return null;mc._asset=mc._asset||{file:mc.file,animation:{frameList:{Count:0,get_Item:()=>null},fps:12,speed:1,repeatDelay:0,swing:false,frameCount:0}};return mc._asset;}};
 packageItems.push(mc);resources['ui://fixture0mc1']=mc;files['/pkg/mc.jta']='JTA';
 // 引用方所属的资源：对象 id 后缀 n3_fix01 / n4_fix01 里的 fix01 要能解析到它，
 // 而 n4_ghost 解析不到——这正是真机上「解析成功才回报」的判定依据。
 const ownerItem={id:'fix01',name:'BridgeFixture.xml',type:'component',title:'BridgeFixture',path:'/',file:'/pkg/BridgeFixture.xml',width:400,height:300,exported:true,folderAtlas:'',owner:pkg,
  GetURL:()=>'ui://fixture0fix01',SetChanged(){},EnsureOpen(){},GetAsset:()=>null,UnloadAsset(){}};
 packageItems.push(ownerItem);resources['ui://fixture0fix01']=ownerItem;
 files['/pkg/package.xml']=serializePackageXml();
 // red 被两个属性槽引用：一个宿主对象在已打开的包里（名字可解析），一个 id 后缀
 // 解析不到所属资源（必须报 null，不许编）。
 // valueType 照真机 6.1.4 的实测填：image 的 src 回报 id，loader 的 url 回报 url
 // （见 tests/reports/p8-2-live.json）。填反了会让写侧「哪些槽位带 fileName」的
 // 判定在一个真机不存在的形态上通过。image 节点还带 fileName，因为原生批量替换
 // 就是不改它——这条半状态要能被测试钉住。
 refRegistry={
  'ui://fixture0red':[
   {itemId:'mc1',propKey:'src',arrayIndex:0,valueType:0,
    content:makeXmlNode('image',{id:'n3_fix01',name:'picture',src:'red',fileName:'red.png',xy:'10,20'})},
   {itemId:'ghost1',propKey:'pages',arrayIndex:2,valueType:0,
    content:makeXmlNode('list',{id:'n4_ghost',name:'listItems',pages:'0,1,2'})}
  ],
  'ui://fixture0blue':[]
 };
 // 一个依赖项的 GetURL 会抛错：describeItem 失败时必须退回最小身份信息，
 // 不能让整条只读查询因为一个没加载完的资源失败。
 const brokenDep={id:'brk',name:'broken.png',isSource:false,analysed:true,targetPath:'/',refCount:1,content:null};
 Object.defineProperty(brokenDep,'GetURL',{get(){throw Error('asset not loaded');}});
 const redDep={item:resources['ui://fixture0red'],isSource:false,analysed:true,targetPath:'/',refCount:1,content:null};
 depRegistry={
  'ui://fixture0panel':{
   2:[redDep],
   3:[Object.assign({},redDep,{isSource:true}),redDep,Object.assign({},redDep,{item:brokenDep})]
  },
  'ui://fixture0red':{3:[]}
 };
 const docView={
  CloseDocuments(url){ if(closeMode==='plural-throw'||closeMode==='none')throw Error('invalid arguments ... or the overload is striped by unity'); closeCount++;closeUsed.push('CloseDocuments');closeAndReload(); },
  CloseDocument(url){ if(closeMode==='none')throw Error('or the overload is striped by unity'); closeCount++;closeUsed.push('CloseDocument');closeAndReload(); },
  OpenDocument(url){ if(openMode==='throw')throw Error('open failed'); if(openMode==='null')return null; doc=makeDoc(); return doc; }
 };
 const app={activeDoc:null,project:{opened:true,id:'fixture0',name:'Fixture',basePath:'/pkg',assetsPath:'/pkg',type:'Normal',allPackages:{get Count(){return 1},get_Item:()=>pkg},
  // get_publish_settings / publish 都要读这两个；缺失时前者会在 stringListToArray
  // 上抛 TypeError，于是「设置读取」这条路径在夹具里根本没被跑过。
  activeBranch:'',allBranches:{get Count(){return 0},get_Item:()=>''},
  GetItemByURL:url=>resources[url] || null,
  // Dispose 之后再取包返回「从磁盘重建」的实例：这是 reload 语义的真实形态，
  // 内存对象不重建就等于假装 reload 什么都没发生。
  GetPackage:id=>{if(pkg.disposed){pkg.disposed=false;const r=reopenPackageFromDisk();pkg=r;return r;}return pkg;},
  GetPackageByName:name=>name===pkg.name?pkg:null,GetItem:(pid,id)=>packageItems.find(i=>i.id===id)||null,GetSettings:name=>name==='Publish'?globalSettings:null,SetChanged(){},Save(){}},docView};
 ctx=vm.createContext({exports:{},CS:{FairyEditor:{App:app,FPackageItemType:{IMAGE:'image',FONT:'font',SOUND:'sound',MOVIECLIP:'movieclip',FOLDER:'folder',COMPONENT:'component',GetFileType:p=>p.endsWith('.wav')||p.endsWith('.mp3')?'sound':p.endsWith('.ttf')||p.endsWith('.fnt')?'font':'image'},FTransition:{GetAllowType:()=>true},DependencyQuery:function(){return makeDependencyQuery();},AtlasSettings:function(){return makeAtlasSettings('');},PackSettings:function(){return makePackSettings();},FList:{SINGLE_COLUMN:'column',SINGLE_ROW:'row',FLOW_HZ:'flow_hz',FLOW_VT:'flow_vt',PAGINATION:'pagination'},FGroup:{HORIZONTAL:'hz',VERTICAL:'vt'},FController:function(){const c=makeController('',[]);return c;}},UnityEngine:{Application:{runInBackground:false},Color,Vector2:function(x,y){this.x=x;this.y=y;}},System:{IO:{File:{Exists:p=>p in files,ReadAllText:p=>files[p]},Directory:{GetFiles:()=>({Length:0,get_Item:()=>null})},Path:{Combine:(a,b)=>`${a}/${b}`,GetFullPath:p=>p,IsPathRooted:p=>p.startsWith('/')||/^[A-Za-z]:/.test(p),GetFileName:p=>p.split('/').pop(),GetFileNameWithoutExtension:p=>p.split('/').pop().replace(/\.[^.]+$/,''),GetExtension:p=>{const i=p.lastIndexOf('.');return i<0?'':p.slice(i);}},FileInfo:{},SearchOption:{}}},FairyGUI:{Utils:{XML}}},require:name=>name==='puerts'?{$promise:v=>Promise.resolve(v),$typeof:()=>({})}:{},console});
 const code=fs.readFileSync(path.join(root,'plugin/main.js'),'utf8').split('App.add_onUpdate(onUpdate);')[0];
 vm.runInContext(code,ctx);
 ctx.getActiveDocument=()=>doc;
 ctx.resolveObject=(_,t)=>{const o=objects.find(o=>o.id===t.id);if(!o)throw Error('未找到对象 ID');return o;};
 ctx.findObjectById=(_,id)=>objects.find(o=>o.id===id)||null;
 ctx.describeObject=o=>({id:o.id});ctx.describeDocument=()=>({modified:doc.isModified});
}
function makeDoc(){
 const content={id:'root',name:'root',objectType:'component',resourceURL:'ui://fixture0component',transitions:makeTransitionsCollection(transitions),x:0,y:0,width:400,height:300,scaleX:1,scaleY:1,rotation:0,alpha:1,visible:true,touchable:true,grayed:false,text:'',icon:'',
  get numChildren(){return objects.length},GetChildAt:i=>objects[i],GetChild:n=>objects.find(o=>o.name===n)||null,
  get controllers(){return {Count:controllers.length,get_Item:i=>controllers[i]}},
  GetController:n=>controllers.find(c=>c.name===n)||null,
  AddController(c){controllers.push(c);return c;},
  RemoveController(c){const i=controllers.indexOf(c);if(i>=0)controllers.splice(i,1);}};
 const d={content,docURL:'ui://fixture0component',dead:false,
  history:{CanUndo:()=>false,CanRedo:()=>false,GetPendingList:()=>({Count:0})},
  SetModified(v){this.isModified=v;},RefreshInspectors(){},RefreshTransition(){},SetSelection(o){this.selected=o;},SelectObject(){},
  UpdateTransitions(xml){transitions.length=0;for(let i=0;i<xml.elements.Count;i++){const c=xml.elements.get_Item(i);if(c.name==='transition')transitions.push(rebuildTransitionFromXml(c));}},
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
 controllers.length=0;
 for(const n of parsed.children.filter(c=>c.name==='controller')){
  const c=makeController(n.attrs.name,(n.attrs.pages||'').split(',').filter((s,i)=>i%2===1));
  if(n.attrs.selected!==undefined)c._selectedIndex=Number(n.attrs.selected);
  controllers.push(c);
 }
 const list=parsed.children.find(n=>n.name==='displayList');
 objects=(list?list.children:[]).map(n=>{
  const a=n.attrs;
  const xy=(a.xy||'0,0').split(',').map(Number),size=(a.size||'0,0').split(',').map(Number);
  const scale=(a.scale||'1,1').split(',').map(Number);
  const o={id:a.id,name:a.name,x:xy[0],y:xy[1],width:size[0],height:size[1],scaleX:scale[0],scaleY:scale[1]??scale[0],rotation:Number(a.rotation||0),alpha:Number(a.alpha||1),visible:a.visible!=='false',touchable:a.touchable!=='false',grayed:a.grayed==='true',text:a.text??a.title??'',icon:a.icon||'',GetProperty(p){return this[p];},SetProperty(p,v){this[p]=v;}};
  if(n.name==='image'){o.objectType='image';o.resourceURL='ui://fixture0'+a.src;}
  if(n.name==='component'){o.objectType='component';o.resourceURL='ui://fixture0'+a.src;if(a.src==='panel'){o.numChildren=1;o.GetChildAt=()=>makeInner();}else o.numChildren=0;}
  if(n.name==='loader'){o.objectType='loader';o.url=a.url;}
  if(n.name==='text'){Object.assign(o,{objectType:'text',font:a.font||'',fontSize:Number(a.fontSize||0),color:hexToColor(a.color),align:a.align||'left',verticalAlign:a.vAlign||'top',leading:Number(a.leading||0),letterSpacing:Number(a.letterSpacing||0),autoSize:a.autoSize||'none'});}
  if(n.name==='list'){Object.assign(o,{objectType:'list',layout:a.layout||'column',selectionMode:a.selectionMode||'single',lineGap:Number(a.lineGap||0),columnGap:Number(a.colGap||0),defaultItem:a.defaultItem||'',autoResizeItem:a.autoItemSize==='true',align:a.align||'none',verticalAlign:a.vAlign||'none',selectionController:a.selectionController||'',foldInvisibleItems:a.foldInvisibleItems==='true',clearOnPublish:a.autoClearItems==='true',scrollItemToViewOnClick:a.scrollItemToViewOnClick==='true',overflow:a.overflow||'visible',marginStr:a.margin||'0,0,0,0',numChildren:0,GetChildAt:()=>null});}
  if(n.name==='group'){Object.assign(o,{objectType:'group',advanced:a.advanced==='true',layout:a.layout||'',lineGap:Number(a.lineGap||0),columnGap:Number(a.colGap||0),excludeInvisibles:a.excludeInvisibles==='true',mainGridMinSize:Number(a.gridMinSize||0),mainGridIndex:Number(a.gridIndex||0),autoSizeDisabled:a.autoSizeDisabled==='true',collapsed:a.collapsed==='true'});}
  attachLayoutMembers(o);
  for(const c of n.children){
   if(c.name==='relation')o.relations._items.push({owner:o,target:c.attrs.target?{id:c.attrs.target}:null,sidePair:c.attrs.sidePair||'',desc:c.attrs.sidePair||''});
   if(c.name==='gearDisplay'){const g={controller:controllers.find(x=>x.name===c.attrs.controller)||null,pages:(c.attrs.pages||'').split(',').filter(s=>s.length)};o._gears[0]=g;}
  }
  return o;
 });
 // Models an attribute the Editor silently drops when parsing: disk XML is
 // correct but the reloaded object is not. Only a real round-trip catches this.
 if(dropOnReload)for(const o of objects)if(o.id==='text1')o.fontSize=24;
 transitions.length=0;
 if(!dropTransitionOnReload)for(const n of parsed.children.filter(c=>c.name==='transition'))transitions.push(rebuildTransitionFromXml(new XML(n)));
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
 const ctrlXml=controllers.map(c=>`<controller name="${esc(c.name)}" pages="${c._pages.map(p=>`${p.id},${p.name}`).join(',')}" selected="${c._selectedIndex}"/>`).join('');
 return '<component size="400,300">'+ctrlXml+'<displayList>'+objects.map(o=>{
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
 if(o.objectType==='component')a.src=o.resourceURL.slice('ui://fixture0'.length);
 if(o.objectType==='loader')a.url=o.url;
 if(o.objectType==='text'){Object.assign(a,{font:o.font,fontSize:o.fontSize,color:ctx.colorHex(o.color),align:o.align,vAlign:o.verticalAlign,leading:o.leading,letterSpacing:o.letterSpacing,autoSize:o.autoSize});omitDefaults(a);}
 if(o.objectType==='list'){
  if(o.layout&&o.layout!=='column')a.layout=o.layout;
  if(o.selectionMode&&o.selectionMode!=='single')a.selectionMode=o.selectionMode;
  if(o.lineGap)a.lineGap=o.lineGap;
  if(o.columnGap)a.colGap=o.columnGap;
  if(o.defaultItem)a.defaultItem=o.defaultItem;
  if(o.autoResizeItem)a.autoItemSize='true';
  a.align=o.align||'none';a.vAlign=o.verticalAlign||'none';
  if(o.selectionController)a.selectionController=o.selectionController;
  if(o.foldInvisibleItems)a.foldInvisibleItems='true';
  if(o.clearOnPublish)a.autoClearItems='true';
  if(o.scrollItemToViewOnClick)a.scrollItemToViewOnClick='true';
  if(o.overflow&&o.overflow!=='visible')a.overflow=o.overflow;
  if(o.marginStr&&o.marginStr!=='0,0,0,0')a.margin=o.marginStr;
 }
 if(o.objectType==='group'){
  if(o.advanced)a.advanced='true';
  if(o.layout)a.layout=o.layout;
  if(o.lineGap)a.lineGap=o.lineGap;
  if(o.columnGap)a.colGap=o.columnGap;
  if(o.excludeInvisibles)a.excludeInvisibles='true';
  if(o.autoSizeDisabled)a.autoSizeDisabled='true';
  if(o.collapsed)a.collapsed='true';
 }
 const attrs=Object.entries(a).map(([k,v])=>`${k}="${esc(v)}"`).join(' ');
 const children=[];
 const relItems=o.relations&&o.relations._items||[];
 for(const r of relItems)children.push(`<relation target="${r.target?esc(String(r.target.id||'')):''}" sidePair="${esc(r.sidePair||'')}"/>`);
 const gear=o._gears&&o._gears[0];
 if(gear&&gear.controller)children.push(`<gearDisplay controller="${esc(gear.controller.name)}" pages="${(gear.pages||[]).join(',')}"/>`);
 return children.length?`<${o.objectType} ${attrs}>${children.join('')}</${o.objectType}>`:`<${o.objectType} ${attrs}/>`;
 }).join('')+'</displayList>'+serializeTransitions()+'</component>';
}
function test(name,run){tests.push({name,run});}
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
test('Repeated Image replacement does not recreate objects',()=>{replace('image1');const disk=files['fixture.xml'];replace('image1');assert.equal(replaceCount,1);assert.equal(objects.length,4);assert.equal(files['fixture.xml'],disk);});
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
test('insert_object saves and reads the new node back from XML',()=>{const r=insert();assert.equal(r.persisted,true);assert.equal(r.strength,'disk');assert.equal(r.verification.xml.name,'inserted');assert.equal(r.verification.xml.resourceURL,'ui://fixture0red');assert.equal(r.verification.xml.x,5);assert.equal(objects.length,5);});
test('insert_object rejects reload without save before inserting',()=>{rejects(()=>insert({save:false,externalReload:true}),'invalid_argument','input');assert.equal(objects.length,4);});
test('remove_object verifies absence on disk after save',()=>{const r=remove('loader1');assert.equal(r.persisted,true);assert.equal(r.verification.xmlReadback,true);assert.equal(objects.length,3);assert.ok(!files['fixture.xml'].includes('loader1'));});
test('remove_object external reload proves the node stays gone',()=>{const r=remove('loader1',{externalReload:true});assert.equal(r.strength,'reload');assert.equal(r.verification.reload.absent,true);assert.equal(closeCount,1);});
test('remove_object without save does not claim persistence',()=>{const r=remove('loader1',{save:false});assert.equal(r.saved,false);assert.equal(r.persisted,false);assert.equal(files['fixture.xml'],fixture);});
test('remove_object fails closed when the disk write is stale',()=>{saveMode='stale';rejects(()=>remove('loader1'),'persistence_failed','xml');});
const upsert=(extra={})=>ctx.upsertTransition({transition:{name:'fade',frameRate:30,items:[{type:'Alpha',targetId:'image1',frame:0,value:{value:0}}]},save:true,...extra});
test('upsert_transition persists through save and disk readback',()=>{const r=upsert();assert.equal(r.ok,true);assert.equal(r.persisted,true);assert.equal(r.strength,'disk');assert.equal(r.target.type,'transition');assert.equal(r.verification.xml.present,true);assert.equal(r.verification.xml.itemCount,1);assert.equal(r.transitions.length,1);});
test('upsert_transition without save never claims persistence',()=>{const r=upsert({save:false});assert.equal(r.saved,false);assert.equal(r.persisted,false);assert.equal(r.strength,'none');assert.ok(!files['fixture.xml'].includes('fade'));});
test('upsert_transition external reload round-trips the transition',()=>{const r=upsert({externalReload:true});assert.equal(r.strength,'reload');assert.equal(r.verification.reload.performed,true);assert.equal(r.verification.reload.values.itemCount,1);assert.equal(closeCount,1);});
test('upsert_transition rejects reload without save before mutating',()=>{rejects(()=>upsert({save:false,externalReload:true}),'invalid_argument','input');assert.equal(transitions.length,0);assert.equal(closeCount,0);});
test('upsert_transition fails closed when save throws',()=>{saveMode='throw';rejects(()=>upsert(),'persistence_failed','save');assert.equal(transitions.length,1);});
test('upsert_transition fails closed on stale XML',()=>{saveMode='stale';rejects(()=>upsert(),'persistence_failed','xml');});
test('upsert_transition reload catches a transition the reload drops',()=>{dropTransitionOnReload=true;rejects(()=>upsert({externalReload:true}),'persistence_failed','reload');});
test('add_transition_item persists the new item count',()=>{upsert();const r=ctx.addTransitionItem({name:'fade',item:{type:'Alpha',targetId:'loader1',frame:5,value:{value:1}},save:true});assert.equal(r.persisted,true);assert.equal(r.verification.xml.itemCount,2);});
test('remove_transition verifies absence on disk after save',()=>{upsert();const r=ctx.removeTransition({name:'fade',save:true});assert.equal(r.persisted,true);assert.equal(r.verification.xml.present,false);assert.ok(!files['fixture.xml'].includes('name="fade"'));});
test('remove_transition external reload proves it stays gone',()=>{upsert();const r=ctx.removeTransition({name:'fade',save:true,externalReload:true});assert.equal(r.strength,'reload');assert.equal(r.verification.reload.values.present,false);assert.equal(closeCount,1);});
test('mutation failure still restores the transition snapshot',()=>{upsert({save:false});assert.throws(()=>ctx.addTransitionItem({name:'fade',item:{type:'Alpha',targetId:'missing-target',frame:0,value:{value:1}}}),/targetId/);assert.equal(transitions.find(t=>t.name==='fade')._items.length,1);});
const importImage=(extra={})=>ctx.importImage({packageName:'Fixture',sourcePath:'/src/new.png',save:true,...extra});
test('import_image saves package manifest and verifies item on disk',async()=>{files['/src/new.png']='PNGDATA';const r=await importImage();assert.equal(r.persisted,true);assert.equal(r.strength,'disk');assert.equal(r.verification.xml.present,true);assert.equal(r.verification.xml.name,'new');assert.equal(r.verification.xml.fileExists,true);});
test('import_image external reload reloads the asset from disk',async()=>{files['/src/new.png']='PNGDATA';const r=await importImage({externalReload:true});assert.equal(r.strength,'reload');assert.equal(r.verification.reload.strategy,'assetReload');assert.equal(r.verification.reload.performed,true);});
test('import_image without save does not claim persistence',async()=>{files['/src/new.png']='PNGDATA';const r=await importImage({save:false});assert.equal(r.saved,false);assert.equal(r.persisted,false);assert.ok(!files['/pkg/package.xml'].includes('new.png'));});
test('import_image fails closed when the package save is stale',async()=>{files['/src/new.png']='PNGDATA';pkgSaveMode='stale';await assert.rejects(()=>importImage(),e=>e.code==='persistence_failed'&&e.details.stage==='xml');});
test('create_component rejects externalReload before mutating',()=>{assert.throws(()=>ctx.createComponent({packageName:'Fixture',componentName:'NewC',save:true,externalReload:true}),e=>e.code==='invalid_argument'&&e.details.stage==='input');assert.equal(packageItems.filter(i=>i.name==='NewC.xml').length,0);});
test('create_component saves the package manifest',()=>{const r=ctx.createComponent({packageName:'Fixture',componentName:'NewC',save:true});assert.equal(r.persisted,true);assert.equal(r.strength,'disk');assert.equal(r.verification.xml.type,'component');assert.equal(r.saved,true);});
test('remove_movieclip verifies absence in package.xml after save',async()=>{const r=await ctx.removeMovieClip({url:'ui://fixture0mc1',force:true,save:true});assert.equal(r.persisted,true);assert.equal(r.strength,'disk');assert.equal(r.verification.xml.present,false);assert.ok(!files['/pkg/package.xml'].includes('mc1'));});
test('remove_movieclip rejects externalReload before deleting',async()=>{await assert.rejects(()=>ctx.removeMovieClip({url:'ui://fixture0mc1',force:true,save:true,externalReload:true}),e=>e.code==='invalid_argument'&&e.details.stage==='input');assert.ok(resources['ui://fixture0mc1']);});
test('remove_movieclip without save keeps absence unverified',async()=>{const r=await ctx.removeMovieClip({url:'ui://fixture0mc1',force:true,save:false});assert.equal(r.saved,false);assert.equal(r.persisted,false);assert.equal(r.strength,'none');});
// --- verify_document tree spec --------------------------------------------
const TREE_SPEC={type:'component',children:[
 {id:'image1',type:'image',resourceURL:'ui://fixture0red'},
 {name:'icon',type:'loader'},
 {name:'title',type:'text',fontSize:24},
 {name:'panel',type:'component',children:[{name:'innerLabel',fontSize:12}]}
]};
test('Tree spec compares structure and props on Editor and disk',()=>{const r=ctx.verifyDocument({expected:TREE_SPEC});assert.equal(r.persisted,true);assert.equal(r.strength,'disk');assert.equal(r.verification.mode,'tree');assert.equal(r.verification.checked,6);assert.equal(r.verification.xmlChecked,5);assert.equal(r.verification.xmlSkipped,1);});
test('Tree spec targets a subtree and leaves XML deeper levels unclaimed',()=>{const r=ctx.verifyDocument({target:{id:'comp1'},expected:{type:'component',children:[{name:'innerLabel',fontSize:12}]}});assert.equal(r.persisted,true);assert.equal(r.verification.checked,2);assert.equal(r.verification.xmlChecked,1);assert.equal(r.verification.xmlSkipped,1);});
test('Tree spec exact mode fails on missing child',()=>rejects(()=>ctx.verifyDocument({expected:{children:[{id:'image1'}]}}),'editor_rejected','editor'));
test('Tree spec exact mode fails on extra child',()=>{objects.push({id:'extra1',name:'extra',objectType:'image',resourceURL:'ui://fixture0red'});rejects(()=>ctx.verifyDocument({expected:TREE_SPEC}),'editor_rejected','editor');});
test('Tree spec fails on property mismatch deep in the tree',()=>{assert.throws(()=>ctx.verifyDocument({expected:{children:[{id:'image1'},{name:'icon'},{name:'title',fontSize:99},{name:'panel',children:[{name:'innerLabel'}]}]}}),e=>e.code==='editor_rejected'&&e.details.node==='expected.children[2]');});
test('Tree spec subset mode tolerates extra children',()=>{objects.push({id:'extra1',name:'extra',objectType:'image',resourceURL:'ui://fixture0red'});const r=ctx.verifyDocument({expected:{childrenMode:'subset',children:[{id:'text1',fontSize:24},{name:'panel'}]}});assert.equal(r.verification.editorReadback,true);assert.equal(r.persisted,true);assert.equal(r.strength,'disk');});
test('Tree spec subset mode reports a missing node as target_not_found',()=>rejects(()=>ctx.verifyDocument({expected:{childrenMode:'subset',children:[{name:'nope'}]}}),'target_not_found','editor'));
test('Tree spec subset child without a locator is rejected at input',()=>rejects(()=>ctx.verifyDocument({expected:{childrenMode:'subset',children:[{fontSize:24}]}}),'invalid_argument','input'));
test('Tree spec unknown property is rejected at input',()=>rejects(()=>ctx.verifyDocument({expected:{children:[{id:'image1',evil:1}]}}),'unsupported_property','input'));
test('Tree spec childrenMode without children is rejected',()=>rejects(()=>ctx.verifyDocument({expected:{childrenMode:'subset'}}),'invalid_argument','input'));
test('Tree spec flat expected still requires target',()=>rejects(()=>ctx.verifyDocument({expected:{fontSize:24}}),'invalid_argument','input'));
test('Tree spec XML count mismatch fails closed',()=>{files['fixture.xml']=files['fixture.xml'].replace(/<component id="comp1"[^/]*\/>/,'');rejects(()=>ctx.verifyDocument({expected:TREE_SPEC}),'persistence_failed','xml');});
test('Tree spec XML property mismatch names the node',()=>{files['fixture.xml']=files['fixture.xml'].replace('fontSize="24"','fontSize="99"');assert.throws(()=>ctx.verifyDocument({expected:TREE_SPEC}),e=>e.code==='persistence_failed'&&e.details.stage==='xml'&&e.details.node==='expected.children[2]');});
test('Tree spec reload walks the whole tree on the reopened document',()=>{const r=ctx.verifyDocument({expected:TREE_SPEC,externalReload:true});assert.equal(r.strength,'reload');assert.equal(r.verification.reload.checked,6);assert.equal(closeCount,1);});
test('Tree spec reload catches a value the reload drops',()=>{text();dropOnReload=true;assert.throws(()=>ctx.verifyDocument({expected:{childrenMode:'subset',children:[{id:'text1',fontSize:40}]},externalReload:true}),e=>e.code==='persistence_failed'&&e.details.stage==='reload');});
test('Tree spec reload refuses a dirty document before closing',()=>{doc.SetModified(true);rejects(()=>ctx.verifyDocument({expected:TREE_SPEC,externalReload:true}),'invalid_argument','reload');assert.equal(closeCount,0);});
// --- Phase 4: list/group layout, relation, gearDisplay, controller ----------
function addListObject(){
 const o={id:'list1',name:'lst',objectType:'list',x:300,y:10,width:200,height:100,scaleX:1,scaleY:1,rotation:0,alpha:1,visible:true,touchable:true,grayed:false,text:'',icon:'',
  layout:'column',selectionMode:'single',lineGap:0,columnGap:0,defaultItem:'',autoResizeItem:false,align:'none',verticalAlign:'none',selectionController:'',foldInvisibleItems:false,clearOnPublish:false,scrollItemToViewOnClick:false,overflow:'visible',marginStr:'0,0,0,0',numChildren:0,GetChildAt:()=>null,GetProperty(p){return this[p];},SetProperty(p,v){this[p]=v;}};
 attachLayoutMembers(o);objects.push(o);return o;
}
function addGroupObject(){
 const o={id:'grp1',name:'grp',objectType:'group',x:300,y:200,width:120,height:60,scaleX:1,scaleY:1,rotation:0,alpha:1,visible:true,touchable:false,grayed:false,text:'',icon:'',
  advanced:false,layout:'',lineGap:0,columnGap:0,excludeInvisibles:false,mainGridMinSize:0,mainGridIndex:0,autoSizeDisabled:false,collapsed:false,GetProperty(p){return this[p];},SetProperty(p,v){this[p]=v;}};
 attachLayoutMembers(o);objects.push(o);return o;
}
const setList=(fields,extra={})=>ctx.handleCommand({action:'set_list_layout',params:{target:{id:'list1'},save:true,...fields,...extra}});
const setGroup=(fields,extra={})=>ctx.handleCommand({action:'set_group_layout',params:{target:{id:'grp1'},save:true,...fields,...extra}});
const setRel=(id,relations,extra={})=>ctx.handleCommand({action:'set_relation',params:{target:{id},relations,save:true,...extra}});
const setGear=(id,controller,pages,extra={})=>ctx.handleCommand({action:'set_gear_display',params:{target:{id},controller,pages,save:true,...extra}});
const setCtrl=(extra={})=>ctx.handleCommand({action:'set_controller',params:{name:'c1',save:true,...extra}});

test('set_list_layout persists typed fields through save and disk readback',()=>{addListObject();const r=setList({layout:'flow_vertical',lineGap:8,columnGap:4});assert.equal(r.persisted,true);assert.equal(r.strength,'disk');assert.equal(r.after.layout,'flow_vt');assert.equal(r.verification.xml.lineGap,8);assert.equal(r.verification.xml.columnGap,4);});
test('set_list_layout rejects a non-list target',()=>{rejects(()=>ctx.handleCommand({action:'set_list_layout',params:{target:{id:'text1'},lineGap:8,save:true}}),'invalid_argument','input');});
test('set_list_layout rejects an unknown field before mutating',()=>{addListObject();rejects(()=>setList({evil:1}),'unsupported_property','input');assert.equal(objects.find(o=>o.id==='list1').lineGap,0);});
test('set_list_layout without fields is rejected',()=>{addListObject();rejects(()=>ctx.handleCommand({action:'set_list_layout',params:{target:{id:'list1'},save:true}}),'invalid_argument','input');});
test('set_list_layout resolves defaultItem to a component resource',()=>{addListObject();const r=setList({defaultItem:'ui://fixture0panel'});assert.equal(r.persisted,true);assert.equal(r.verification.xml.defaultItem,'ui://fixture0panel');});
test('set_list_layout external reload round-trips layout fields',()=>{addListObject();const r=setList({layout:'flow_horizontal',lineGap:6},{externalReload:true});assert.equal(r.strength,'reload');assert.equal(r.verification.reload.values.layout,'flow_hz');assert.equal(closeCount,1);});
test('set_list_layout fails closed on stale XML',()=>{addListObject();saveMode='stale';rejects(()=>setList({lineGap:8}),'persistence_failed','xml');});
test('set_group_layout requires advanced for layout fields',()=>{addGroupObject();rejects(()=>setGroup({layout:'vt'}),'invalid_argument','input');});
test('set_group_layout persists advanced group fields',()=>{addGroupObject();const r=setGroup({advanced:true,layout:'vertical',lineGap:12,excludeInvisibles:true});assert.equal(r.persisted,true);assert.equal(r.verification.xml.advanced,true);assert.equal(r.verification.xml.excludeInvisibles,true);assert.equal(r.after.layout,'vt');});
test('set_relation persists parent and object-target relations',()=>{const r=setRel('text1',[{sidePair:'right-right'},{target:{id:'image1'},pairs:[{source:'width',target:'width'}]}]);assert.equal(r.persisted,true);assert.equal(r.verification.xml['relation.'],'right-right');assert.equal(r.verification.xml['relation.image1'],'width-width');});
test('set_relation round-trips through external reload',()=>{const r=setRel('text1',[{sidePair:'width-width,height-height'}],{externalReload:true});assert.equal(r.strength,'reload');assert.equal(r.verification.reload.values['relation.'],'height-height,width-width');});
test('set_relation rejects an invalid sidePair before mutating',()=>{rejects(()=>setRel('text1',[{sidePair:'bogus-pair'}]),'invalid_argument','input');assert.equal(objects[2].relations._items.length,0);});
test('set_relation rejects a self target',()=>{rejects(()=>setRel('text1',[{target:{id:'text1'},sidePair:'left-left'}]),'invalid_argument','input');});
test('set_gear_display binds a controller page and persists',()=>{const r=setGear('image1','c1',['1']);assert.equal(r.persisted,true);assert.equal(r.verification.xml['gearDisplay.controller'],'c1');assert.equal(r.verification.xml['gearDisplay.pages'],'1');});
test('set_gear_display accepts page names and resolves to ids',()=>{const r=setGear('image1','c1',['page1']);assert.equal(r.persisted,true);assert.equal(r.verification.xml['gearDisplay.pages'],'1');});
test('set_gear_display clears the gear when controller is empty',()=>{setGear('image1','c1',['0']);const r=setGear('image1','');assert.equal(r.persisted,true);assert.equal(r.verification.xml['gearDisplay.controller'],'');});
test('set_gear_display rejects a missing controller',()=>{rejects(()=>setGear('image1','nope',['0']),'target_not_found','input');assert.equal(objects[0]._gears.length,0);});
test('set_gear_display reload round-trips controller and pages',()=>{const r=setGear('image1','c1',['0','1'],{externalReload:true});assert.equal(r.strength,'reload');assert.equal(r.verification.reload.values['gearDisplay.controller'],'c1');});
test('set_controller creates a controller and persists pages',()=>{const r=ctx.handleCommand({action:'set_controller',params:{name:'c2',create:true,pages:['a','b'],save:true}});assert.equal(r.persisted,true);assert.equal(r.verification.xml.pageCount,2);assert.equal(r.verification.xml.pageNames,'a,b');});
test('set_controller replaces pages and updates selection',()=>{const r=setCtrl({pages:['x','y','z'],selectedIndex:2});assert.equal(r.persisted,true);assert.equal(r.after.pageNames,'x,y,z');assert.equal(r.verification.xml.selectedIndex,2);});
test('set_controller missing name without create fails as target_not_found',()=>{rejects(()=>ctx.handleCommand({action:'set_controller',params:{name:'ghost',pages:['a'],save:true}}),'target_not_found','input');});
test('set_controller remove verifies absence on disk',()=>{const r=setCtrl({remove:true});assert.equal(r.persisted,true);assert.equal(r.verification.xml.present,false);assert.ok(!files['fixture.xml'].includes('name="c1"'));});
test('set_controller reload proves the controller survives reopen',()=>{const r=setCtrl({selectedIndex:1,externalReload:true});assert.equal(r.strength,'reload');assert.equal(r.verification.reload.values.selectedIndex,1);assert.equal(closeCount,1);});
test('list_controllers returns the component controller set',()=>{const r=ctx.handleCommand({action:'list_controllers',params:{}});assert.equal(r.controllers.length,1);assert.equal(r.controllers[0].name,'c1');assert.equal(r.controllers[0].pageNames,'page0,page1');});
test('Phase 4 write actions are refused without a save-safe reload combo',()=>{addListObject();rejects(()=>ctx.handleCommand({action:'set_list_layout',params:{target:{id:'list1'},lineGap:8,externalReload:true}}),'invalid_argument','input');});

// ---- P8-0: 写入路径归位到编辑器文档模型层（DocElement） ----
// 6.1.4 实测绕过文档模型会让文档状态与序列化结果不一致，save 可能静默成功却什么都没写。
// 这些用例钉住三件事：优先走文档模型、失败可回退、绕过时 fail-closed。
test('set_property prefers the document model and reports writePath',()=>{const o=objects[2];const seen=[];o.docElement={SetProperty(p,v){seen.push([p,v]);o[p]=v;}};const r=set('text1','x',42);assert.equal(r.writePath,'document-model');assert.deepEqual(seen,[['x',42]]);assert.equal(o.x,42);assert.equal(r.persisted,true);});
test('a rejected document-model write falls back to the object model',()=>{const o=objects[2];o.docElement={SetProperty(){throw Error('doc element rejected')}};const r=set('text1','x',24);assert.equal(r.writePath,'object-model');assert.equal(o.x,24);assert.equal(r.persisted,true);});
test('a write that never marks the document dirty fails closed before save',()=>{doc.SetModified=()=>{};rejects(()=>set('text1','x',11),'persistence_failed','modified');});
test('an idempotent replace is not mistaken for a document-model bypass',()=>{const r=replace('image1');const disk=files['fixture.xml'];const r2=replace('image1');assert.equal(r2.ok,true);assert.equal(r2.saved,true);assert.equal(files['fixture.xml'],disk);});
test('writes without a document element still report the object-model path',()=>{const r=set('text1','x',13);assert.equal(r.writePath,'object-model');assert.equal(r.persisted,true);});
// 真机复验发现的缺陷：writePath 早先只在 set_property 路径里赋值，其余写路径
// 继承上一个 action 的值，于是 set_text_style 会报出 document-model —— 谎报。
test('writePath is declared per action and never inherited from the previous one',()=>{
  const o=objects[2];
  // 模拟宿主默认不给 docElement，set_relation 会落到对象模型回退；这里显式补上
  // 文档模型入口，才能观察到两条路径各自的声明。
  o.docElement={
    SetProperty(p,v){o[p]=v;},
    UpdateRelations(xml){
      o.relations.Reset();
      if(!xml)return;
      for(let i=0;i<xml.elements.Count;i++){
        const e=xml.elements.get_Item(i);
        if(e.name!=='relation')continue;
        const pair=String(e.GetAttribute('sidePair')||'');
        if(!pair)continue;
        const tid=String(e.GetAttribute('target')||'');
        o.relations.AddItem(objects.find(x=>x.id===tid)||null,pair);
      }
    },
    SetRelation(){}
  };
  assert.equal(set('text1','x',41).writePath,'document-model');
  assert.equal(text().writePath,'object-model');          // 成员赋值，不得继承上一条
  assert.equal(setRel('text1',[{sidePair:'width-width,height-height'}]).writePath,'document-model');
  assert.equal(text().writePath,'object-model');          // 同样不得被上一条污染
  delete o.docElement;
  assert.equal(set('text1','x',42).writePath,'object-model');
});

// ---- P8-2: 资源引用图（只读） ----
// 编辑器原生的 DependencyQuery 能给出 propKey / arrayIndex 这种「哪个对象的哪个
// 属性槽」的精度。这些用例钉住四件事：槽位精度不丢、只读动作真的不写、截断必须
// 显式上报、单个资源描述失败不得拖垮整条查询。
const refs=(extra={})=>ctx.handleCommand({action:'query_references',params:{url:'ui://fixture0red',...extra}});
const deps=(extra={})=>ctx.handleCommand({action:'query_dependencies',params:{url:'ui://fixture0panel',...extra}});
test('query_references reports the exact property slot that holds the reference',()=>{
  const r=refs();
  assert.equal(r.readOnly,true);
  assert.equal(r.totalCount,2);
  const first=r.references[0];
  // referencedItem 是「被引用的资源」——ReferenceInfo 自身的身份字段指的就是它，
  // 早先把它当成引用方，会让 agent 读出「Red 引用了它自己」。
  assert.equal(first.referencedItem.packageId,'fixture0');
  assert.equal(first.referencedItem.packageName,'Fixture');
  assert.equal(first.referencedItem.itemId,'mc1');
  assert.equal(first.referencedItem.itemName,'loop.jta');
  assert.equal(first.slot.element,'image');
  assert.equal(first.slot.propKey,'src');
  assert.equal(first.slot.arrayIndex,0);
  assert.equal(first.slot.valueTypeCode,0);      // 真机 6.1.4：image 的 src 回报 id
  assert.equal(first.slot.valueType,'id');
  // 真正的引用方在 content（XML 元素节点）里
  assert.equal(first.owner.objectId,'n3_fix01');
  assert.equal(first.owner.objectName,'picture');
  assert.equal(first.owner.itemId,'fix01');
  assert.equal(first.owner.itemName,'BridgeFixture.xml');
  assert.equal(first.attributes.src,'red');
  assert.equal(first.attributes.fileName,'red.png');   // image 带 fileName 伴随属性
  assert.equal(first.attributes.xy,'10,20');
});
test('query_references reports a null owner item when the id suffix resolves to nothing',()=>{
  const second=refs().references[1];
  assert.equal(second.referencedItem.itemId,'ghost1');
  assert.equal(second.referencedItem.itemName,null);      // 包里没有这个 item，不许编一个名字
  assert.equal(second.slot.element,'list');
  assert.equal(second.slot.propKey,'pages');
  assert.equal(second.slot.arrayIndex,2);
  assert.equal(second.slot.valueType,'id');
  assert.equal(second.owner.objectId,'n4_ghost');
  assert.equal(second.owner.itemId,null);                 // fix01 之外的猜测一律不回报
  assert.equal(second.attributes.pages,'0,1,2');
});
test('An unreferenced resource returns an empty list, not a missing result',()=>{
  const r=ctx.handleCommand({action:'query_references',params:{url:'ui://fixture0blue'}});
  assert.equal(r.totalCount,0);
  assert.equal(r.references.length,0);
  assert.equal(r.truncated,false);
});
test('query_dependencies echoes the resolved seekLevel instead of assuming the default',()=>{
  const byDefault=deps();
  assert.equal(byDefault.seekLevel,'samePackage');
  assert.equal(byDefault.seekLevelCode,2);
  assert.equal(byDefault.totalCount,1);
  const all=deps({seekLevel:'all'});
  assert.equal(all.seekLevel,'all');
  assert.equal(all.seekLevelCode,3);
  assert.equal(all.totalCount,3);
  assert.equal(all.dependencies[0].isSource,true);
  assert.equal(deps({seekLevel:'same_package'}).seekLevelCode,2);   // 分隔符写法不敏感
  assert.equal(deps({seekLevel:3}).seekLevel,'all');                // 数值原样映射到名字
});
test('An unknown seekLevel and an out-of-range code are rejected before querying',()=>{
  rejects(()=>deps({seekLevel:'everything'}),'invalid_argument','input');
  rejects(()=>deps({seekLevel:9}),'invalid_argument','input');
  rejects(()=>deps({maxItems:0}),'invalid_argument','input');
  rejects(()=>deps({maxItems:99999}),'invalid_argument','input');
});
test('Truncation is reported explicitly, never silently dropped',()=>{
  const r=refs({maxItems:1});
  assert.equal(r.totalCount,2);
  assert.equal(r.references.length,1);
  assert.equal(r.truncated,true);
  assert.equal(refs().truncated,false);
  assert.equal(deps({seekLevel:'all',maxItems:2}).truncated,true);
});
test('A dependency item that cannot be described degrades to a minimal identity',()=>{
  const all=deps({seekLevel:'all'});
  const broken=all.dependencies[2].item;
  assert.equal(broken.id,'brk');
  assert.equal(broken.name,'broken.png');
  assert.equal(broken.url,null);              // 取不到就报 null，不报一段假文本
  assert.equal(all.dependencies[0].item.id,'red');    // 同一次查询里其他项照常返回
});
test('Reference queries never touch the document or the disk',()=>{
  const before=files['fixture.xml'];
  const r=refs({maxItems:1});
  const d=deps({seekLevel:'all'});
  assert.equal(r.readOnly,true);
  assert.equal(d.readOnly,true);
  assert.equal(doc.isModified,false);
  assert.equal(files['fixture.xml'],before);
  assert.equal(pkg.changed,undefined);
});
test('An unresolvable resource is rejected before any query runs',()=>{
  assert.throws(()=>ctx.handleCommand({action:'query_references',params:{url:'ui://nope'}}),/未找到/);
  assert.throws(()=>ctx.handleCommand({action:'query_dependencies',params:{url:'ui://nope'}}),/未找到/);
});
test('A project-wide query opens closed packages instead of silently undercounting',()=>{
  pkg.opened=false;
  const r=refs();
  assert.equal(pkg.opened,true);
  assert.equal(r.packages.opened,1);
  assert.equal(r.packages.skipped,false);
  assert.equal(r.packages.packageCount,1);
  const already=refs();                     // 已经打开的不重复计数
  assert.equal(already.packages.opened,0);
});
test('skipPackageOpen is an explicit opt-out that is reported as skipped',()=>{
  pkg.opened=false;
  const r=refs({skipPackageOpen:true});
  assert.equal(r.packages.skipped,true);
  assert.equal(r.packages.opened,0);
  assert.equal(pkg.opened,false);            // 代价可见，漏算风险由调用方自行承担
});


// ---- P8-2 写侧：全工程引用替换（0.8.11） ----
// 原生 ReplaceReferences 只收新资源，old 来自同一实例上 QueryReferences 查出的那批；
// 它立即改包 XML，不产生脏文档、不进 Agent 撤销栈，也没有 save 兜底。因此这些用例
// 钉住四件事：默认只预览、执行必须重新查询而不是复用预览列表、验证口径是引用图
// 而不是属性、fileName 半状态必须被显式报出而不是被宣称一致。
const replaceRefs=(extra={})=>ctx.handleCommand({action:'replace_references',params:{url:'ui://fixture0red',newUrl:'ui://fixture0blue',...extra}});
test('replace_references defaults to a preview that writes nothing',()=>{
  const r=replaceRefs();
  assert.equal(r.ok,true);
  assert.equal(r.preview,true);
  assert.equal(r.executed,false);
  assert.equal(r.totalCount,2);
  assert.equal(r.references.length,2);
  assert.equal(replaceCallCount,0);          // 预览一次原生写都不能碰
  assert.equal(refRegistry['ui://fixture0red'].length,2);
});
test('Executing re-queries on the executing instance instead of reusing the preview list',()=>{
  const preview=replaceRefs();
  assert.equal(preview.totalCount,2);
  const r=replaceRefs({mode:'execute'});
  assert.equal(r.executed,true);
  assert.equal(replaceCallCount,1);
  assert.equal(lastReplace.from,'ui://fixture0red');
  assert.equal(lastReplace.to,'ui://fixture0blue');
  assert.equal(r.replacedCount,2);
  // 执行时查到的数量必须来自当时的引用图，不是预览那次的结果
  assert.equal(r.totalCount,2);
});
test('Verification is scoped to the reference graph and refuses to claim attribute parity',()=>{
  const r=replaceRefs({mode:'execute'});
  assert.equal(r.verification.ok,true);
  assert.equal(r.verification.scope,'reference-graph');
  assert.equal(r.verification.remainingReferences,0);
  assert.equal(r.verification.targetReferences,2);
  // 原生替换不改 fileName：这是已知的落盘半状态，必须报出来而不是假装干净
  assert.equal(r.staleFileNameSlots,1);     // 两个槽位里只有 image 那个带 fileName
  assert.equal(r.warnings.length,1);
  assert.match(r.warnings[0],/fileName/);
});
test('Executing reports that the write is already on disk and cannot be undone',()=>{
  const r=replaceRefs({mode:'execute'});
  assert.equal(r.persisted,true);
  assert.equal(r.strength,'disk');
  assert.equal(r.undoable,false);
  assert.equal(r.writePath,'native-batch');
});
test('A resource with no references is a reported no-op, not a silent success',()=>{
  const r=ctx.handleCommand({action:'replace_references',params:{url:'ui://fixture0blue',newUrl:'ui://fixture0red',mode:'execute'}});
  assert.equal(r.replacedCount,0);
  assert.equal(r.verification.remainingReferences,0);
  assert.equal(r.staleFileNameSlots,0);
  assert.equal(r.warnings.length,0);       // 跨 realm：逐字段断言，别用 deepEqual
});
test('Replacing a resource with itself is rejected before any write',()=>{
  rejects(()=>ctx.handleCommand({action:'replace_references',params:{url:'ui://fixture0red',newUrl:'ui://fixture0red',mode:'execute'}}),'invalid_argument','input');
  assert.equal(replaceCallCount,0);
});
test('An invalid mode and a non-ui target are rejected before any write',()=>{
  rejects(()=>replaceRefs({mode:'replace'}),'invalid_argument','input');
  rejects(()=>replaceRefs({newUrl:'p93m2'}),'invalid_argument','input');
  rejects(()=>replaceRefs({newUrl:''}),'invalid_argument','input');
  assert.equal(replaceCallCount,0);
});
test('A type change between source and target is reported, never silently applied',()=>{
  const r=replaceRefs({mode:'execute',newUrl:'ui://fixture0panel'});
  assert.equal(r.typeChange.from,'image');
  assert.equal(r.typeChange.to,'component');
  assert.equal(r.from.id,'red');           // from/to 是 resolveItem 拿到的资源本身
  assert.equal(r.to.id,'panel');
});

// ---------------------------------------------------------------- analyze_atlas_fit
function addImage(name,w,h,opts){
 const it=makePackageItem(name,'image','.png');
 it.width=w;it.height=h;
 Object.assign(it,opts||{});
 files[it.file]='PNG';
 return it;
}
const atlasFit=()=>ctx.handleCommand({action:'analyze_atlas_fit',params:{}});
const imgOf=(r,name)=>r.packages[0].images.find(i=>i.name===`${name}.png`);

test('Atlas fit is judged by the real packer limits, not by pixel-size guessing',()=>{
 addImage('small',64,64); addImage('hd',1920,1080); addImage('huge',4096,4096);
 const r=atlasFit();
 assert.equal(imgOf(r,'small').fit,'fits');
 assert.equal(imgOf(r,'huge').fit,'exceeds');
 // 全局 maxSize=2048：1920x1080 装得下，退役常量却会把它标 alone——这正是替换掉的那一刀
 assert.equal(imgOf(r,'hd').fit,'fits');
 assert.equal(imgOf(r,'hd').retiredRuleWouldAssignAlone,true);   // 退役规则会标
 assert.equal(imgOf(r,'hd').wouldAssignAlone,false);             // 真实约束不标
 assert.equal(imgOf(r,'hd').verdict,'leave-as-is');
 assert.equal(imgOf(r,'huge').retiredRuleWouldAssignAlone,true);
 assert.equal(imgOf(r,'huge').wouldAssignAlone,true);            // 4096 确实装不下，alone 是对的
 assert.equal(imgOf(r,'huge').verdict,'assign-alone');
 assert.equal(r.summary.wouldAssignAlone,1);
 // 分歧 = 磁盘标记与判定不一致。huge 磁盘上没标记、真实约束却要标记 → 分歧；
 // hd 磁盘没标记、判定也不要求 → 一致（退役常量说要标，是它自己的事，不构成分歧）。
 assert.equal(imgOf(r,'huge').disagrees,true);
 assert.equal(imgOf(r,'hd').disagrees,false);
 assert.equal(r.summary.disagreements,1);
});
test('An image that exceeds the page reports which constraint bound it and by how much',()=>{
 addImage('wide',3000,1000);
 const e=imgOf(atlasFit(),'wide');
 assert.equal(e.fit,'exceeds');
 assert.equal(e.binding,'maxWidth');
 assert.equal(e.requiredWidth,3000);
 assert.equal(e.limitWidth,2048);
});
test('Padding counts twice per side, which the old rule could never see',()=>{
 pkg.publishSettings=makePackagePublishSettings({useGlobalAtlasSettings:false,
  atlasList:{Count:1,get_Item:()=>makeAtlasSettings('Main',{padding:10})}});
 const it=addImage('edge',2040,10); it._atlasIndex=0;
 const e=imgOf(atlasFit(),'edge');
 assert.equal(e.fit,'exceeds');          // 2040+2*10=2060 > 2048
 assert.equal(e.requiredWidth,2060);
 assert.equal(e.padding,10);
 assert.equal(e.retiredRuleWouldAssignAlone,false);   // 退役常量完全看不到 padding
 assert.equal(e.wouldAssignAlone,true);              // 真实约束看得见，所以该标 alone
 assert.equal(e.disagrees,true);                     // 磁盘没标记而规则要标记
});
test('Rotation rescues a portrait page but is powerless under square packing',()=>{
 pkg.publishSettings=makePackagePublishSettings({useGlobalAtlasSettings:false,
  atlasList:{Count:1,get_Item:()=>makeAtlasSettings('Tall',{maxWidth:2048,maxHeight:4096,rotation:true})}});
 const it=addImage('tall',3000,1000); it._atlasIndex=0;
 assert.equal(imgOf(atlasFit(),'tall').fit,'fits');   // 转 90° 后 1000x3000 装得下
 // 同样的尺寸在方形图集里仍超限：正方形边长在旋转下不变
 pkg.publishSettings=makePackagePublishSettings({useGlobalAtlasSettings:false,
  atlasList:{Count:1,get_Item:()=>makeAtlasSettings('Sq',{maxWidth:2048,maxHeight:2048,square:true,rotation:true})}});
 const e=imgOf(atlasFit(),'tall');
 assert.equal(e.fit,'exceeds');
 assert.equal(e.binding,'squareSide');
});
test('Rotation cannot help a page that is already square in both sides',()=>{
 pkg.publishSettings=makePackagePublishSettings({useGlobalAtlasSettings:false,
  atlasList:{Count:1,get_Item:()=>makeAtlasSettings('Main',{rotation:true})}});
 const it=addImage('wide',3000,1000); it._atlasIndex=0;
 assert.equal(imgOf(atlasFit(),'wide').fit,'exceeds');
});
test('An image smaller than the atlas minimum is judged at the upscaled footprint',()=>{
 pkg.publishSettings=makePackagePublishSettings({useGlobalAtlasSettings:false,
  atlasList:{Count:1,get_Item:()=>makeAtlasSettings('Main',{minWidth:512})}});
 const it=addImage('tiny',64,64); it._atlasIndex=0;
 const e=imgOf(atlasFit(),'tiny');
 assert.equal(e.fit,'fits');
 assert.equal(e.requiredWidth,512);      // 打包器会把它放大到下限
});
test('Unknown limits are reported as unknown, never as a confident fits',()=>{
 globalSettings.atlasSetting.maxSize=0;
 const it=addImage('any',100,100);
 const e=imgOf(atlasFit(),'any');
 assert.equal(e.fit,'unknown');
 assert.equal(e.reason,'limits-unspecified');
 assert.equal(atlasFit().summary.unknown,1);
 // 判不出来不等于「不用标」：写路径据此拒绝下结论，不写盘。
 assert.equal(e.verdict,'unknown');
 assert.equal(e.wouldAssignAlone,false);
 assert.equal(atlasFit().summary.ruleUnknown,1);
});
test('A resource pinned to an unconfigured atlas is unknown, not silently judged',()=>{
 pkg.publishSettings=makePackagePublishSettings({useGlobalAtlasSettings:false,atlasList:{Count:1,get_Item:()=>makeAtlasSettings('Main')}});
 const it=addImage('pinned',100,100); it._persistedAtlas='alone';
 files['/pkg/package.xml']=serializePackageXml();
 const e=imgOf(atlasFit(),'pinned');
 assert.equal(e.fit,'unknown');
 assert.equal(e.reason,'atlas-not-configured');
 // 但「这个 alone 标记该不该留」仍然判得出来：alone 不是 atlasList 里的图集名，
 // 忽略该标记后按 GetAtlasIndex 落到 Main。少了这一条，被标过的图在包级约束
 // 模式下永远 unknown，也就永远看不到可纠正的候选。
 assert.equal(e.effectiveFit,'fits');
 assert.equal(e.verdict,'alone-not-needed');
 assert.equal(e.aloneNotNeeded,true);
});
test('The atlas assignment is read from disk, not from the in-memory folderAtlas',()=>{
 // 真机 6.1.4：磁盘写了 atlas="alone"，重启后内存 folderAtlas 却回到空串。
 // 若按内存值解析归属，这张图会被当成「没指定图集」，判定整个走偏。
 pkg.publishSettings=makePackagePublishSettings({useGlobalAtlasSettings:false,atlasList:{
  Count:2,get_Item:i=>i===0?makeAtlasSettings('Small',{maxWidth:512,maxHeight:512}):makeAtlasSettings('Big',{maxWidth:4096,maxHeight:4096})}});
 const it=addImage('pinned',3000,3000); it.folderAtlas=''; it._persistedAtlas='Big'; it._atlasIndex=0;
 files['/pkg/package.xml']=serializePackageXml();
 const e=imgOf(atlasFit(),'pinned');
 assert.equal(e.atlas,'Big');              // 磁盘上的 Big，而不是 GetAtlasIndex() 的 0(Small)
 assert.equal(e.fit,'fits');
 assert.equal(e.folderAtlasInMemory,'');     // 内存确实为空，输出如实回报
 assert.equal(e.folderAtlasOnDisk,'Big');
});
test('Images already marked alone on disk but actually fitting are counted',()=>{
 addImage('hd',1920,1080); addImage('huge',4096,4096);
 for(const it of packageItems.filter(i=>i.name.startsWith('AtlasFixture')||i.name.startsWith('hd')||i.name.startsWith('huge')))it._persistedAtlas='alone';
 files['/pkg/package.xml']=serializePackageXml();
 const r=atlasFit();
 assert.equal(imgOf(r,'hd').assignedAloneOnDisk,true);
 assert.equal(imgOf(r,'huge').assignedAloneOnDisk,true);
 assert.equal(r.summary.assignedAloneButFits,1);   // 只有 hd 是「标了 alone 但其实装得下」
 assert.equal(r.folderAtlasRoundTrip.memoryMatchesDisk,false);
});
test('Each image is judged against the atlas it actually belongs to',()=>{
 pkg.publishSettings=makePackagePublishSettings({useGlobalAtlasSettings:false,atlasList:{
  Count:2,get_Item:i=>i===0?makeAtlasSettings('Small',{maxWidth:512,maxHeight:512}):makeAtlasSettings('Big',{maxWidth:4096,maxHeight:4096})}});
 const a=addImage('a',300,300); a._atlasIndex=0;
 const b=addImage('b',3000,3000); b._atlasIndex=1;
 const r=atlasFit();
 assert.equal(imgOf(r,'a').atlas,'Small');
 assert.equal(imgOf(r,'b').atlas,'Big');
 assert.equal(imgOf(r,'a').fit,'fits');
 assert.equal(imgOf(r,'b').fit,'fits');   // 放在 Big 里装得下
});
test('Images that never enter an atlas are counted as skipped, not judged',()=>{
 const it=addImage('noatlas',100,100); it.supportAtlas=false;
 const r=atlasFit();
 assert.equal(r.packages[0].summary.skippedNotAtlasable,1);
 assert.equal(r.packages[0].images.length,0);
});
test('Analyzing atlas fit is read-only: no atlas assignment and no dirty package',()=>{
 const it=addImage('hd',1920,1080);
 atlasFit();
 assert.equal(it.folderAtlas,'');         // 只读动作不得顺手标 alone
 assert.ok(!pkg.changed);
});
test('The report states that the retired constant rule is no longer applied',()=>{
 addImage('hd',1920,1080);
 const r=atlasFit();
 assert.equal(r.legacyRule.retiredIn,'0.8.14');
 assert.equal(r.legacyRule.stillAppliedOnPublish,false);
 assert.equal(r.legacyRule.alsoAppliedOnImport,false);
 assert.equal(r.legacyRule.longSideMin,1920);   // 常量留着只为解释历史标记的来历
});
test('The report says which constraint source the write path now judges by',()=>{
 // 导入与发布写的是同一条规则，报告必须能让读者确认它们不会各判各的。
 addImage('hd',1920,1080);
 assert.equal(atlasFit().folderAtlasRoundTrip.usedByWritePath,true);
 const pub=ctx.handleCommand({action:'get_publish_settings',params:{}});
 assert.equal(pub.atlasAssignmentRule.rule,'packer-constraints');
 assert.equal(pub.atlasAssignmentRule.aloneAtlas,'alone');
 assert.equal(pub.atlasAssignmentRule.folderAtlasSource,'package.xml');
});
test('A missing package is rejected',()=>{
 // 与相邻的 get_publish_settings 保持一致：对不存在的包抛普通 Error，不新造错误码
 assert.throws(()=>ctx.handleCommand({action:'analyze_atlas_fit',params:{packageName:'NoSuchPackage'}}),/未找到包/);
});


// ------------------------------------------------ atlas assignment on the write path
// 0.8.14：import_image / publish 不再用硬编码尺寸常量，改与 analyze_atlas_fit 共用
// decideAtlasAssignment。这一组钉的是**契约**：谁写盘、什么时候拒绝写、
// 以及跨重启后不重复施加。真机（6.1.4）证据见 tests/reports/p8-5-judgement-live.json。
function stubImportedDimensions(){
 // 真机上导入的图片带真实尺寸；夹具的 makePackageItem 恒为 64x64，
 // 那样所有导入用例都只跑「装得下」这一条分支，判定逻辑等于没被测到。
 const base=pkg.ImportResource;
 pkg.ImportResource=function(sourcePath,folderPath,fileName){
  const it=base.call(pkg,sourcePath,folderPath,fileName);
  const dims=/(\d+)x(\d+)\.png$/.exec(String(sourcePath));
  if(dims){it.width=Number(dims[1]);it.height=Number(dims[2]);}
  return it;
 };
}
const importSized=(w,h,extra={})=>{
 const src=`/src/img_${w}x${h}.png`;files[src]='PNGDATA';
 return ctx.importImage({packageName:'Fixture',sourcePath:src,save:true,...extra});
};

test('import_image assigns alone when the image really exceeds the pack limits',async()=>{
 stubImportedDimensions();
 const r=await importSized(4096,4096);
 assert.equal(r.atlasAssignment.verdict,'assign-alone');
 assert.equal(r.atlasAssignment.applied,true);
 assert.equal(r.atlasAssignment.binding,'maxWidth');
 assert.equal(r.atlasAssignment.limitWidth,2048);
 assert.equal(r.atlasAssignment.requiredWidth,4096);
 // 光断言内存字段不够：这条规则的真机副作用是 package.xml 里的 atlas 属性
 assert.ok(files['/pkg/package.xml'].includes('atlas="alone"'),'alone 必须真落进 package.xml');
});
test('import_image no longer marks 1920x1080 alone, which the retired constant rule did',async()=>{
 // 本次替换的核心回归：2048 的页装得下 1920x1080，退役常量的 1920/1080/2048
 // 三条硬阈值却会标 alone，且导入当场就落盘（真机已验，见 p8-5-atlas-fit-live.json）。
 stubImportedDimensions();
 const r=await importSized(1920,1080);
 assert.equal(r.atlasAssignment.verdict,'leave-as-is');
 assert.equal(r.atlasAssignment.applied,false);
 assert.equal(r.atlasAssignment.reason,'fits');
 assert.equal(r.atlasAssignment.retiredRuleWouldAssignAlone,true);   // 退役规则会标
 assert.ok(!files['/pkg/package.xml'].includes('atlas="alone"'),'装得下的图不该被标 alone');
});
test('Unsolvable constraints stop the rule from writing instead of guessing',async()=>{
 // fail-closed：上限都没告诉 packer 多大，就不能说「装得下」，更不能顺手写 alone。
 stubImportedDimensions();
 globalSettings.atlasSetting.maxSize=0;
 const r=await importSized(4096,4096);
 assert.equal(r.atlasAssignment.verdict,'unknown');
 assert.equal(r.atlasAssignment.applied,false);
 assert.equal(r.atlasAssignment.reason,'limits-unspecified');
 assert.ok(!files['/pkg/package.xml'].includes('atlas="alone"'));
});
test('A restart does not make the rule re-apply an alone marker that is already on disk',async()=>{
 // 真机 6.1.4：folderAtlas 写盘保留、重启后内存回到空串。幂等守卫若读内存值，
 // 重启后每次 publish 都会重复施加并重复 SetChanged（0.8.13 的真实缺陷）。
 stubImportedDimensions();
 const first=await importSized(4096,4096);
 assert.equal(first.atlasAssignment.applied,true);
 const it=packageItems[packageItems.length-1];
 assert.equal(it.folderAtlas,'');              // 真机形态：重启后内存为空
 assert.equal(it._persistedAtlas,'alone');     // 磁盘上仍然是 alone
 const r=await ctx.importImage({packageName:'Fixture',sourcePath:'/src/img_4096x4096.png',save:false,conflictPolicy:'replace'});
 assert.equal(r.atlasAssignment.verdict,'already-alone');
 assert.equal(r.atlasAssignment.applied,false);
});
test('An alone marker that the real constraints say is unnecessary is reported, not silently cleared',async()=>{
 // 包级约束模式下 alone 不在 atlasList 里，按现状解析只会得到 atlas-not-configured →
 // unknown，被标过的图永远看不到「该不该留」。忽略该标记后判得出来，但**不改**：
 // 清除标记的落盘语义还没在真机上验证过，不能拿它当顺带产物。
 pkg.publishSettings=makePackagePublishSettings({useGlobalAtlasSettings:false,
  atlasList:{Count:1,get_Item:()=>makeAtlasSettings('Main',{maxWidth:4096,maxHeight:4096})}});
 const it=addImage('marked',1920,1080); it._persistedAtlas='alone'; it.folderAtlas='';
 files['/pkg/package.xml']=serializePackageXml();
 const e=imgOf(atlasFit(),'marked');
 assert.equal(e.fit,'unknown');                 // as-is 口径：alone 不是配置的图集
 assert.equal(e.reason,'atlas-not-configured');
 assert.equal(e.verdict,'alone-not-needed');   // 有效口径：忽略标记后装得下
 assert.equal(e.aloneNotNeeded,true);
 assert.equal(e.disagrees,true);
});
test('The write path and the analysis agree on the same verdict',async()=>{
 // 两套口径必然打脸：分析说装得下、导入却标 alone。这一条钉住它们是同一个函数。
 stubImportedDimensions();
 await importSized(4096,4096);
 await importSized(1920,1080);
 const r=atlasFit();
 const huge=imgOf(r,'img_4096x4096');
 const hd=imgOf(r,'img_1920x1080');
 assert.equal(huge.assignedAloneOnDisk,true);
 assert.equal(huge.verdict,'already-alone');     // 磁盘已是 alone，且确实超限
 assert.equal(hd.assignedAloneOnDisk,false);
 assert.equal(hd.verdict,'leave-as-is');          // 磁盘无标记，真实约束也不要求
 assert.equal(hd.folderAtlasOnDisk,'');
 assert.equal(r.summary.wouldAssignAlone,1);   // Huge：该单独成图集（磁盘上已经是对的）
 assert.equal(r.summary.assignedAloneButFits,0);
 assert.equal(r.summary.disagreements,0);      // 两张图的磁盘标记都与判定一致
});


// -------------------------------------------------------------- set_publish_settings
// 包级发布设置走对象模型（FPackage.publishSettings 是只读 getter，且没有
// DocElement 入口）。这一组用例钉的是**契约**：写路径声明、fail-closed 顺序、
// 全量替换语义、以及 reload 必须是「从磁盘重建」而不是复用内存对象。
const setPub=(settings,extra)=>ctx.handleCommand({action:'set_publish_settings',
  params:Object.assign({packageName:pkg.name,settings:settings},extra||{})});

test('Package publish settings are written through the object model and say so',()=>{
 const r=setPub({genCode:true,codePath:'/gen'});
 assert.equal(r.writePath,'object-model');
 assert.equal(r.after.genCode,true);
 assert.equal(r.after.codePath,'/gen');
 assert.equal(r.before.genCode,false);       // before/after 都回报，调用方才看得出改了什么
 assert.equal(r.verification.editorReadback,true);
});
test('An unknown field is rejected before the package is touched',()=>{
 // 顺序很重要：校验必须发生在写入之前，否则「拒绝」时包已经被改了一半。
 assert.throws(()=>setPub({nope:1}),/未知的settings字段：nope/);
 assert.equal(pkg.publishSettings.genCode,false);
 assert.equal(pkg.changed,undefined);
});
test('A wrong-typed scalar is rejected before the package is touched',()=>{
 assert.throws(()=>setPub({genCode:'yes'}),/settings\.genCode 需要布尔值/);
 assert.equal(pkg.publishSettings.genCode,false);
 assert.throws(()=>setPub({path:123}),/settings\.path 需要字符串/);
});
test('sizeOption is a read-side projection and cannot be written back',()=>{
 // readPackSettings 把 pot 归一化成 sizeOption 输出；写回它不会落盘，纯静默丢失。
 assert.throws(()=>setPub({atlasList:[{name:'Main',packSettings:{sizeOption:'pot'}}]}),/sizeOption/);
 assert.equal(pkg.publishSettings.atlasList.Count,0);
});
test('The pack settings are edited in place, never replaced wholesale',()=>{
 // 真机实测：packSettings 是只读属性。整条替换的实现会在真机上抛
 // "Cannot assign to read only property"，而在旧夹具里一路绿灯。
 pkg.publishSettings.atlasList.Clear();
 pkg.publishSettings.atlasList.Add(makeAtlasSettings('Old'));
 const r=setPub({atlasList:[{name:'Main',packSettings:{maxWidth:1024,maxHeight:1024,padding:10}}]});
 assert.equal(r.after.atlasList.length,1);
 assert.equal(r.after.atlasList[0].packSettings.maxWidth,1024);
 // 包级 PackSettings 的其余字段保持编辑器新建对象的默认值，不由 Bridge 决定。
 assert.equal(r.after.atlasList[0].packSettings.square,false);
 assert.equal(r.after.atlasList[0].packSettings.multiPage,true);
});
test('An empty atlas list is refused before it can corrupt the package',()=>{
 // 真机实测（Editor 6.1.4）：atlasList 清空后保存，FPackage.SavePublishSettings 抛
 // "Index was out of range"，且该包此后每次 Save 都崩——是一次失败就把工程留在
 // 坏状态里，所以必须写入前就拒绝。
 assert.throws(()=>setPub({atlasList:[]}),/atlasList 不能是空列表/);
 assert.ok(pkg.publishSettings.atlasList.Count>=0);   // 没有发生 Clear
});
test('Fields with no disk encoding are disclosed before the caller asks for a reload',()=>{
 // 真机实测：package.xml 的 <publish> 只编码 maxAtlasSize / multiPage / extractAlpha，
 // padding 根本没有对应属性，写了也留不住。调用方必须在写之前就能看到这件事，
 // 而不是等 externalReload 把它变成一次失败才发现。
 const r=setPub({atlasList:[{name:'Main',packSettings:{maxWidth:2048,padding:20}}]},{save:true});
 const byField={};r.persistenceProfile.requested.forEach(e=>byField[e.field]=e.status);
 assert.equal(byField.maxWidth,'persisted');
 assert.equal(byField.padding,'losesValue');
 assert.equal(r.persistenceProfile.diskNode,'package.xml <publish>');
 assert.ok(r.note.indexOf('padding(Main)')>=0,'note 必须点出留不住的字段');
});
test('The atlas list is replaced wholesale, not merged into',()=>{
 pkg.publishSettings.atlasList.Clear();
 pkg.publishSettings.atlasList.Add(makeAtlasSettings('Old'));
 pkg.publishSettings.atlasList.Add(makeAtlasSettings('Older'));
 const r=setPub({atlasList:[{name:'Main',compression:true,packSettings:{maxWidth:1024,maxHeight:1024,padding:10}}]});
 assert.equal(r.after.atlasList.length,1);          // 旧的两条不残留
 assert.equal(r.after.atlasList[0].name,'Main');
 assert.equal(r.after.atlasList[0].packSettings.maxWidth,1024);
 assert.equal(r.after.atlasList[0].packSettings.padding,10);
});
test('Duplicate atlas names are rejected',()=>{
 // 重名会让资源上的 folderAtlas 指向哪一条变得不确定。
 assert.throws(()=>setPub({atlasList:[{name:'A'},{name:'A'}]}),/重复图集名/);
 assert.equal(pkg.publishSettings.atlasList.Count,0);
});
test('An empty atlas name is rejected',()=>{
 assert.throws(()=>setPub({atlasList:[{name:''}]}),/不能为空/);
});
test('A negative pack size is rejected before anything is written',()=>{
 assert.throws(()=>setPub({atlasList:[{name:'Main',packSettings:{padding:-1}}]}),/padding 需要非负有限数值/);
 assert.equal(pkg.publishSettings.atlasList.Count,0);
});
test('The excluded list is rebuilt from the request',()=>{
 const r=setPub({excludedList:['a','b']});
 assert.equal(r.after.excludedList.length,2);
 assert.equal(r.after.excludedList[0],'a');
 assert.equal(r.after.excludedList[1],'b');
});
test('External reload without a save is rejected up front',()=>{
 assert.throws(()=>setPub({genCode:true},{save:false,externalReload:true}),/需要先保存/);
});
test('Saving writes a publish node into package.xml',()=>{
 const r=setPub({useGlobalAtlasSettings:false},{save:true});
 assert.equal(r.saved,true);
 assert.ok(String(files['/pkg/package.xml']).indexOf('<publish')>=0);
 assert.equal(r.verification.xmlReadback,true);
 assert.equal(r.verification.xml.present,true);
 assert.equal(r.verification.xml.attributes.useGlobalAtlasSettings,'false');
});
test('Package-level pack settings survive a dispose and reopen',()=>{
 const r=setPub({useGlobalAtlasSettings:false,atlasList:[
  {name:'Main',packSettings:{maxWidth:1024,maxHeight:2048,padding:10,rotation:true}}]},{save:true,externalReload:true});
 assert.equal(r.verification.externalReload,true);
 assert.equal(r.strength,'reload');
 assert.equal(r.verification.reload.strategy,'package-dispose-open');
 // reload 后的内存必须是从磁盘重建的：重建出来的包对象不是原来那个。
 assert.equal(pkg.isReopened,true);
 assert.equal(pkg.publishSettings.useGlobalAtlasSettings,false);
 assert.equal(pkg.publishSettings.atlasList.Count,1);
 assert.equal(pkg.publishSettings.atlasList.get_Item(0).name,'Main');
});
test('A failed save is a persistence failure, not a silent success',()=>{
 pkgSaveMode='throw';
 assert.throws(()=>setPub({genCode:true},{save:true}),/保存包或工程失败/);
});
test('Package-level settings are not judged by the global atlas setting once opted out',()=>{
 // set_publish_settings 的核心用途：造一个 useGlobalAtlasSettings=false 的包，
 // 让包级 PackSettings 真正生效。没有它，包级约束路径只存在于模拟宿主。
 const it=addImage('hd',1920,1080);
 setPub({useGlobalAtlasSettings:false,atlasList:[
  {name:'Main',packSettings:{maxWidth:1024,maxHeight:1024,padding:10}}]},{save:true});
 files['/pkg/package.xml']=serializePackageXml();
 const e=imgOf(atlasFit(),'hd');
 assert.equal(e.constraintsSource,'package');
 assert.equal(e.fit,'exceeds');          // 包级上限 1024，比全局 2048 严
 assert.equal(e.requiredWidth,1940);     // 1920 + 2*10
 assert.equal(e.retiredRuleWouldAssignAlone,true);
 assert.equal(e.wouldAssignAlone,true);  // 包级约束同样判它装不下 → 要标 alone
 assert.equal(e.disagrees,true);         // 磁盘上还没有这个标记，正是待施加的那一张
});


// verification *logic* against a mocked host, never Editor acceptance.
(async()=>{
for(const {name,run} of tests){try{setup();await run();results.push({name,passed:true});}catch(e){results.push({name,passed:false,error:e.stack,details:e.details||null});}}
const report={schemaVersion:1,suite:'p0-persistence-host',evidence:'mocked-editor-host',liveEditorVerified:false,mockedExternalReloadCovered:true,externalReloadVerified:false,passed:results.filter(r=>r.passed).length,total:results.length,cases:results};
const output=JSON.stringify(report,null,2)+'\n';
if(process.argv[2]==='--report'&&process.argv[3])fs.writeFileSync(process.argv[3],output);
process.stdout.write(output);if(results.some(r=>!r.passed))process.exitCode=1;
})();
