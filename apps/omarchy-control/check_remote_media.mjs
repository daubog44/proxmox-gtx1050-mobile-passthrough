// node apps/omarchy-control/check_remote_media.mjs — existing TypeScript, no test framework.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(name, globals) {
  const source = readFileSync(new URL(`./src/utils/${name}.ts`, import.meta.url), 'utf8').replace(/^import .*$/mg, '');
  const code = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const context = {exports:{}, ...globals};
  vm.runInNewContext(code, context);
  return context.exports;
}
class Element extends EventTarget {
  disabled = false; dataset = {}; classList = {contains:()=>false};
  setAttribute() {} removeAttribute() {} focus() { doc.activeElement = this; }
  setPointerCapture() {} load() {} pause() {} play() { return Promise.resolve(); }
  getBoundingClientRect() { return {left:100,top:200,width:800,height:600}; }
}
class Video extends Element { videoWidth = 2560; videoHeight = 1600; currentTime = 0; buffered = {length:0}; }
const doc = new Element(), video = new Video(), viewport = new Element(), button = new Element(), label = new Element(), modal = new Element();
viewport.querySelector = () => video;
modal.querySelector = selector => selector.includes('viewport') ? viewport : selector.includes('takeover') ? button : label;
let tick, requests = [], resolveStart;
const api = {sessionControl: async (_, body) => {
  requests.push(body);
  return body.action === 'start' ? new Promise(resolve => {resolveStart = resolve;}) : {};
}};
const globals = {api,crypto:{randomUUID:()=> 'viewer-a'},document:doc,window:{setInterval:fn=>(tick=fn,1),addEventListener(){},removeEventListener(){}},clearInterval(){},HTMLVideoElement:Video,TextEncoder,Date,console};
const {remotePosition, wireRemoteInput} = load('remote_input', globals);
const rect = viewport.getBoundingClientRect();
for (const [width,height] of [[2560,1600],[1280,800],[2880,1800]]) {
  const center = remotePosition(rect,width,height,500,500);
  assert.equal(center.x,0.5); assert.equal(center.y,0.5);
}
assert.equal(remotePosition(rect,2560,1600,500,205), null); // black bar
assert.equal(remotePosition(rect,0,0,500,500),null);
assert.equal(remotePosition(rect,2560,1600,2000,2000,true).x,1); // captured drag
assert.equal(remotePosition({...rect,width:0},2560,1600,500,500),null);
const cleanup = wireRemoteInput(modal,'wolf-test','admin',message=>{throw new Error(message);});
assert.equal(button.disabled,true);
modal.dataset.videoReady = 'true'; viewport.dispatchEvent(new Event('remote-media-state'));
const starting = button.onclick();
cleanup(); resolveStart({lease:'old'}); await starting;
assert.equal(requests.at(-1).action,'stop'); assert.equal(requests.at(-1).lease,'old');
assert.equal(modal.dataset.controlling,'false');

requests = [];
const cleanup2 = wireRemoteInput(modal,'wolf-test','admin',message=>{throw new Error(message);});
viewport.dispatchEvent(new Event('remote-media-state'));
const start2 = button.onclick(); resolveStart({lease:'current'}); await start2;
function pointer(type,x,y) {
  const event = new Event(type,{cancelable:true});
  Object.assign(event,{clientX:x,clientY:y,button:0,pointerId:1}); viewport.dispatchEvent(event);
}
pointer('pointerdown',500,205); await tick();
assert.equal(requests.at(-1).events.length,0); // letterbox must not click an old position
pointer('pointerdown',500,500); pointer('pointermove',2000,2000);
viewport.dispatchEvent(new Event('pointercancel')); await tick();
const events = requests.at(-1).events;
assert.equal(events[0].x,0.5); assert.equal(events[0].y,0.5);
assert.equal(events.at(-2).x,1); assert.equal(events.at(-2).y,1);
assert.equal(events.at(-1).down,false); // cancelled drag releases button
modal.dataset.videoReady = 'false'; viewport.dispatchEvent(new Event('remote-media-state'));
assert.equal(requests.at(-1).action,'stop'); assert.equal(button.disabled,true);
cleanup2();

let sources = 0, buffers = 0;
class MediaSource extends EventTarget {
  readyState = 'open';
  constructor() {super(); sources++; queueMicrotask(()=>this.dispatchEvent(new Event('sourceopen')));}
  static isTypeSupported() {return true;}
  addSourceBuffer() {buffers++; const b = new Element(); b.appendBuffer=()=>{}; return b;}
  endOfStream() {}
}
const {createLiveVideoPlayer} = load('live_video',{window:{MediaSource},URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},DOMException,console});
const player = createLiveVideoPlayer(video,message=>{throw new Error(message);});
const init = new Uint8Array([0,0,0,12,97,118,99,67,1,100,0,31]);
player.push(init.buffer); player.push(init.buffer); // chunks arrive before sourceopen
await new Promise(resolve=>setImmediate(resolve));
assert.equal(sources,1); assert.equal(buffers,1); // exactly one codec setup, no duplicate SourceBuffer
player.destroy(); player.push(init.buffer); assert.equal(buffers,1);
console.log('Remote media: letterbox, resize, drag cancel, closed start, video loss and single MSE setup OK');
