/* ================================================================
 * 补药 3.0 · 内核（工具 / 数据层 / 提醒引擎 / 本地 OCR）
 * 设计原则：只记录，不判断。数据留在本地。
 * ================================================================ */
'use strict';

/* ---------------- 工具 ---------------- */
function $(s){ return document.querySelector(s); }
function $$(s){ return Array.prototype.slice.call(document.querySelectorAll(s)); }
function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function pad2(n){ return n < 10 ? '0'+n : ''+n; }
function dstr(d){ d = d || new Date(); return d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate()); }
function today(){ return dstr(); }
function nowHM(){ var d = new Date(); return pad2(d.getHours())+':'+pad2(d.getMinutes()); }
function nowMin(){ var d = new Date(); return d.getHours()*60 + d.getMinutes(); }
function esc(s){
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function ico(name, cls){
  return '<svg class="ico'+(cls?' '+cls:'')+'"><use href="#i-'+name+'"/></svg>';
}
function weekCN(d){ return '周'+['日','一','二','三','四','五','六'][d.getDay()]; }
function fmtCN(s){
  if(!s) return '';
  var p = s.split('-');
  return parseInt(p[1],10)+'月'+parseInt(p[2],10)+'日';
}
function dayDiff(a, b){
  var x = new Date(a.replace(/-/g,'/')); x.setHours(0,0,0,0);
  var y = new Date(b.replace(/-/g,'/')); y.setHours(0,0,0,0);
  return Math.round((y - x) / 86400000);
}
function daysTo(s){ return dayDiff(today(), s); }
function addDays(s, n){
  var d = new Date(s.replace(/-/g,'/'));
  d.setDate(d.getDate() + n);
  return dstr(d);
}
function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }

/* ---------------- 常量 ---------------- */
var CATS = ['全部','情绪','睡眠','精神类','慢病','抗生素','维生素','中药','外用','其他'];

var MOODS = [
  { v:1, face:'😞', label:'很糟' },
  { v:2, face:'😕', label:'有点低' },
  { v:3, face:'😐', label:'还行' },
  { v:4, face:'🙂', label:'不错' },
  { v:5, face:'😄', label:'很好' }
];

/* 常见的身体反应选项（供勾选，不构成任何医学建议） */
var EFFECTS = ['恶心','嗜睡','头晕','口干','没胃口','食欲变好','体重变化','便秘','出汗','心慌','失眠','多梦','乏力','手抖','注意力难集中','情绪起伏','其他'];

var RISKS = ['需缓慢减量','不可与酒精同用','饭后服用','避免驾驶或操作机械','定期复查肝功能','定期复查血常规','孕妇及哺乳期慎用'];

/* ---------------- 数据层 ---------------- */
var DB_KEY = 'xinqing_v3';

var DB = {
  v: 3,
  meds: [],
  logs: [],
  moods: [],
  members: [],
  doctors: [],
  settings: {
    theme: 'light',
    sound: true,
    notify: false,
    mask: true,          // 提醒脱敏
    reminderText: '',    // 自定义提醒文案（会员）
    channels: { app:true, wechat:false, sms:false, email:false },
    contacts: { phone:'', email:'', wechat:'' },
    startDate: '',       // 治疗起始日（用于起效期陪伴）
    disclaimerAt: 0,
    snoozeUntil: ''
  }
};

function loadDB(){
  try{
    var raw = localStorage.getItem(DB_KEY);
    if(raw){
      var d = JSON.parse(raw);
      DB.meds    = d.meds    || [];
      DB.logs    = d.logs    || [];
      DB.moods   = d.moods   || [];
      DB.members = d.members || [];
      DB.doctors = d.doctors || [];
      DB.settings = Object.assign({}, DB.settings, d.settings || {});
      if(!DB.settings.channels) DB.settings.channels = { app:true, wechat:false, sms:false, email:false };
      if(!DB.settings.contacts) DB.settings.contacts = { phone:'', email:'', wechat:'' };
    }
  }catch(e){ console.warn('loadDB', e); }

  if(DB.members.length === 0){
    DB.members.push({ id:'me', name:'我自己', relation:'本人', color:'#FF8FB1' });
  }
}
function saveDB(){
  try{ localStorage.setItem(DB_KEY, JSON.stringify(DB)); }
  catch(e){ toast('存储空间不足，建议先导出备份'); }
}

/* ---------------- 查询辅助 ---------------- */
function getMed(id){ for(var i=0;i<DB.meds.length;i++) if(DB.meds[i].id===id) return DB.meds[i]; return null; }
function getMember(id){ for(var i=0;i<DB.members.length;i++) if(DB.members[i].id===id) return DB.members[i]; return null; }
function memberName(id){ var m = getMember(id); return m ? m.name : '未分配'; }
function getMood(date){
  for(var i=0;i<DB.moods.length;i++) if(DB.moods[i].date===date) return DB.moods[i];
  return null;
}
function logsOf(date){
  return DB.logs.filter(function(l){ return l.date === date; });
}
function timesOf(med){
  if(med.times && med.times.length) return med.times.slice().sort();
  return ['08:00'];
}
function isDone(medId, time){
  return DB.logs.some(function(l){
    return l.date === today() && l.medId === medId && l.time === time;
  });
}
function dailyDose(med){
  return (parseFloat(med.dose) || 0) * timesOf(med).length;
}
function stockDays(med){
  var dd = dailyDose(med);
  if(!dd) return null;
  return Math.floor((parseFloat(med.stock)||0) / dd);
}

/* 治疗第几天（起效期陪伴） */
function treatDay(){
  if(!DB.settings.startDate) return 0;
  var n = dayDiff(DB.settings.startDate, today()) + 1;
  return n > 0 ? n : 0;
}

/* 依从率 */
function adherence(days){
  days = days || 30;
  var expected = 0, actual = 0;
  for(var i=0;i<days;i++){
    var d = addDays(today(), -i);
    var should = 0;
    DB.meds.forEach(function(m){
      if(m.enabled === false) return;
      if(m.startDate && dayDiff(m.startDate, d) < 0) return;
      should += timesOf(m).length;
    });
    expected += should;
    actual += Math.min(logsOf(d).length, should);
  }
  if(!expected) return { expected:0, actual:0, rate:0 };
  return { expected:expected, actual:actual, rate: Math.round(actual/expected*100) };
}

/* 连续打卡天数 */
function streak(){
  var n = 0, d = today();
  for(var i=0;i<400;i++){
    var should = DB.meds.reduce(function(s,m){
      if(m.enabled === false) return s;
      if(m.startDate && dayDiff(m.startDate, d) < 0) return s;
      return s + timesOf(m).length;
    }, 0);
    if(should === 0){ d = addDays(d,-1); continue; }
    if(logsOf(d).length > 0){ n++; d = addDays(d,-1); }
    else break;
  }
  return n;
}

/* ---------------- Toast ---------------- */
var toastTimer = null;
function toast(msg){
  var t = $('#toast');
  if(!t) return;
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ t.hidden = true; }, 2200);
}

/* ---------------- 弹层 ---------------- */
var modalStack = [];
function openModal(title, html, onMount){
  var mask = $('#modalMask'), box = $('#modal');
  box.innerHTML =
    '<div class="sheet-bar"></div>' +
    '<div class="sheet-h"><h3>'+esc(title)+'</h3>' +
    '<button class="sheet-close" id="mClose">'+ico('x','ico-sm')+'</button></div>' + html;
  mask.hidden = false;
  $('#mClose').onclick = closeModal;
  if(onMount) onMount(box);
  modalStack.push(1);
}
function closeModal(){
  $('#modalMask').hidden = true;
  $('#modal').innerHTML = '';
  modalStack.pop();
}
$('#modalMask') && ($('#modalMask').onclick = function(e){
  if(e.target === this) closeModal();
});

/* ---------------- 提醒引擎 ---------------- */
var reminded = {};
var audioCtx = null;

function beep(){
  if(!DB.settings.sound) return;
  try{
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    var notes = [880, 1046.5, 1318.5];
    notes.forEach(function(f, i){
      var o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      var t0 = audioCtx.currentTime + i*0.24;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.32, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(t0); o.stop(t0 + 0.3);
    });
  }catch(e){}
}

var pendingRemind = null;

function checkReminders(){
  if(DB.settings.snoozeUntil && nowMin() < toMin(DB.settings.snoozeUntil)) return;
  var nm = nowMin();
  var due = [];
  DB.meds.forEach(function(m){
    if(m.enabled === false) return;
    timesOf(m).forEach(function(t){
      var delta = nm - toMin(t);
      if(delta >= 0 && delta <= 12 && !isDone(m.id, t)){
        var key = m.id + '@' + t;
        if(!reminded[key]){ reminded[key] = 1; due.push({ med:m, time:t }); }
      }
    });
  });
  if(due.length && !pendingRemind) showReminder(due[0]);
}
function toMin(hm){
  var p = String(hm||'00:00').split(':');
  return (parseInt(p[0],10)||0)*60 + (parseInt(p[1],10)||0);
}

function showReminder(item){
  pendingRemind = item;
  var m = item.med;
  var masked = DB.settings.mask;
  var custom = DB.settings.reminderText || '';
  var title = masked ? (custom || '记得今天的份') : m.name;
  $('#remTitle').textContent = title;
  $('#remSub').innerHTML = masked
    ? '安排在这一档的事情，别忘啦'
    : esc(m.name) + ' · ' + (m.dose||'') + (m.unit||'');
  $('#reminderOverlay').hidden = false;
  beep();
  notifySystem(masked ? (custom || '记得今天的份') : ('该服用 ' + m.name));
}
function notifySystem(text){
  if(!DB.settings.notify) return;
  try{
    if(window.Notification && Notification.permission === 'granted'){
      new Notification(text, { body:'补药 · 每日陪伴', tag:'xq' });
    }
  }catch(e){}
}

/* ---------------- 本地 OCR ---------------- */
var ocrWorker = null, ocrBusy = false;

function ocrBase(){
  var p = location.pathname;
  return p.substring(0, p.lastIndexOf('/') + 1);
}
function loadOcrScript(cb){
  if(window.Tesseract){ cb(null); return; }
  var s = document.createElement('script');
  s.src = ocrBase() + 'ocr/tesseract.min.js';
  s.onload = function(){ cb(null); };
  s.onerror = function(){ cb(new Error('组件加载失败')); };
  document.head.appendChild(s);
}
function runOcr(dataUrl, onState, onDone){
  if(ocrBusy) return;
  ocrBusy = true;
  onState('正在准备本地识别引擎…', 'loading');
  loadOcrScript(function(err){
    if(err){ ocrBusy = false; onState('本地识别不可用，可直接手动填写', 'err'); return; }
    var base = ocrBase();
    var opts = {
      workerPath: base + 'ocr/worker.min.js',
      corePath:   base + 'ocr/core/tesseract-core-lstm.wasm.js',
      langPath:   base + 'ocr',
      gzip: true,
      workerBlobURL: false,
      logger: function(m){
        if(m.status === 'recognizing text'){
          var pct = Math.round((m.progress||0) * 100);
          if(pct % 15 === 0) onState('正在识别文字… ' + pct + '%', 'loading');
        } else if(m.status === 'loading tesseract core'){
          onState('正在初始化识别引擎…', 'loading');
        }
      }
    };
    Tesseract.createWorker('chi_sim', 1, opts).then(function(w){
      ocrWorker = w;
      return w.recognize(dataUrl);
    }).then(function(res){
      ocrBusy = false;
      onDone((res && res.data && res.data.text) || '');
    })['catch'](function(e){
      ocrBusy = false;
      console.error('OCR', e);
      onState('识别未完成，可直接手动填写', 'err');
    });
  });
}
/* 从识别文本中提取候选名称与日期（纯文本抽取，不做任何药品信息解释） */
function extractFromOcr(text){
  var dates = text.match(/(20\d{2})[\/\-年.](\d{1,2})[\/\-月.](\d{1,2})/g) || [];
  var lines = text.split(/\n+/).map(function(s){ return s.replace(/\s+/g,''); })
                  .filter(function(s){ return s.length >= 2 && s.length <= 22; });
  var black = /批准文号|生产日期|产品批号|有效期|规格|用法用量|适应症|不良反应|禁忌|贮藏|生产企业|国药准字|说明书|请仔细阅读/;
  var cands = [];
  lines.forEach(function(s){
    if(black.test(s)) return;
    if(!/[\u4e00-\u9fa5]/.test(s)) return;
    cands.push(s);
  });
  return { dates: dates.slice(0,6), cands: cands.slice(0,12), raw: text };
}
