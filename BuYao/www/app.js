/* ================================================================
 * 药管家 v1.1 · 服药提醒与用药管理 (纯本地, 无后端)
 * 新增：拍照记录药品照片、本地 OCR 识别药名与效期、UI 全面优化
 * ================================================================ */
'use strict';

/* ---------------- 工具 ---------------- */
function $(s){ return document.querySelector(s); }
function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function pad2(n){ return n < 10 ? '0' + n : '' + n; }
function todayStr(){ var d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth()+1) + '-' + pad2(d.getDate()); }
function nowHM(){ var d = new Date(); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
function weekdayCN(d){
  var w = ['日','一','二','三','四','五','六'];
  return '周' + w[d.getDay()];
}
function fmtDate(s){
  if(!s) return '';
  var p = s.split('-');
  return p[0] + '年' + parseInt(p[1],10) + '月' + parseInt(p[2],10) + '日';
}
function daysBetween(fromStr, toStr){
  var a = new Date(fromStr.replace(/-/g,'/')); a.setHours(0,0,0,0);
  var b = new Date(toStr.replace(/-/g,'/')); b.setHours(0,0,0,0);
  return Math.round((b - a) / 86400000);
}
function daysUntil(dateStr){ return daysBetween(todayStr(), dateStr); }
function escapeHtml(s){
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function hashCode(str){
  var h = 0;
  for(var i=0;i<str.length;i++){ h = (h*31 + str.charCodeAt(i)) | 0; }
  return Math.abs(h);
}
var PALETTE = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#0ea5e9','#ec4899','#14b8a6','#f97316','#6366f1'];
function colorOf(id){ return PALETTE[hashCode(id) % PALETTE.length]; }
/* SVG 图标快捷方式 */
function ico(name, cls){
  return '<svg class="ico ' + (cls||'') + '"><use href="#i-' + name + '"/></svg>';
}

/* ---------------- 数据层 ---------------- */
var DB_KEY = 'medapp_v1';
var DB = {
  meds: [], logs: [], members: [], doctors: [],
  settings: { dark: 0, sound: true, notify: false, snoozeUntil: '', firstRun: true }
};
function loadDB(){
  try{
    var raw = localStorage.getItem(DB_KEY);
    if(raw){
      var d = JSON.parse(raw);
      DB.meds = d.meds || []; DB.logs = d.logs || [];
      DB.members = d.members || []; DB.doctors = d.doctors || [];
      DB.settings = Object.assign({ dark:0, sound:true, notify:false, snoozeUntil:'', firstRun:false }, d.settings || {});
    }
  }catch(e){ console.warn('loadDB', e); }
  if(DB.members.length === 0){
    DB.members.push({ id:'me', name:'我自己', relation:'本人', color:'#3b82f6' });
  }
}
function saveDB(){
  try{ localStorage.setItem(DB_KEY, JSON.stringify(DB)); }
  catch(e){ toast('存储空间不足，请导出备份后清理数据'); }
}
function getMed(id){ return DB.meds.find(function(m){ return m.id === id; }); }
function getMember(id){ return DB.members.find(function(m){ return m.id === id; }); }
function memberName(id){
  var m = getMember(id); return m ? m.name : '未分配';
}
function dailyTimes(med){
  if(med.reminderEnabled && med.reminderTimes && med.reminderTimes.length) return med.reminderTimes.length;
  return Math.max(1, med.timesPerDay || 1);
}
function dailyDose(med){
  return med.dailyDose != null && med.dailyDose > 0 ? med.dailyDose : (med.dosePerTime || 0) * dailyTimes(med);
}
function stockDays(med){
  var dd = dailyDose(med);
  if(!dd || dd <= 0) return null;
  return Math.floor((med.stock || 0) / dd);
}
function isChecked(medId, time){
  var t = todayStr();
  return DB.logs.some(function(l){ return l.date === t && l.medId === medId && (!time || l.time === time); });
}

/* ---------------- 全局状态 ---------------- */
var state = {
  page: 'today',
  cat: '全部',
  search: '',
  calYear: new Date().getFullYear(),
  calMonth: new Date().getMonth(),
  calDay: todayStr(),
  editingMed: null,
  editingDoctor: null,
  medPhoto: null
};

/* ================================================================
 * 提醒引擎
 * ================================================================ */
var remindedToday = {};
var audioCtx = null;
function beep(){
  if(!DB.settings.sound) return;
  try{
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    var notes = [880, 1174.66, 880, 1174.66, 1567.98];
    notes.forEach(function(f, i){
      var o = audioCtx.createOscillator();
      var g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, audioCtx.currentTime + i*0.32);
      g.gain.exponentialRampToValueAtTime(0.5, audioCtx.currentTime + i*0.32 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + i*0.32 + 0.3);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(audioCtx.currentTime + i*0.32); o.stop(audioCtx.currentTime + i*0.32 + 0.35);
    });
  }catch(e){}
}
function notify(title, body){
  try{
    if(DB.settings.notify && 'Notification' in window && Notification.permission === 'granted'){
      new Notification(title, { body: body, tag: 'medremind' });
    }
  }catch(e){}
}
function fireReminder(med, time){
  var doseTxt = (med.dosePerTime || 1) + med.unit + (med.notes ? ' · ' + med.notes : '');
  $('#remTitle').textContent = med.name;
  $('#remSub').textContent = (time || '') + ' 该服药了 · ' + doseTxt + ' · 剩余 ' + (med.stock||0) + med.unit;
  $('#reminderOverlay').hidden = false;
  $('#reminderOverlay').dataset.medId = med.id;
  $('#reminderOverlay').dataset.time = time || '';
  beep();
  notify('⏰ ' + med.name + ' 该服药了', (time||'') + ' · 每次 ' + (med.dosePerTime||1) + med.unit);
}
function checkReminders(){
  if($('#reminderOverlay') && !$('#reminderOverlay').hidden) return;
  var now = new Date();
  var hm = pad2(now.getHours()) + ':' + pad2(now.getMinutes());
  var t = todayStr();
  if(DB.settings.snoozeUntil && hm < DB.settings.snoozeUntil) return;
  DB.settings.snoozeUntil = '';
  DB.meds.forEach(function(med){
    if(!med.reminderEnabled || !med.reminderTimes || !med.reminderTimes.length) return;
    med.reminderTimes.forEach(function(rTime){
      var key = med.id + '|' + rTime + '|' + t;
      if(rTime === hm && !remindedToday[key] && !isChecked(med.id, rTime)){
        remindedToday[key] = true;
        fireReminder(med, rTime);
      }
    });
  });
}
function snooze(){
  var d = new Date(Date.now() + 10*60000);
  DB.settings.snoozeUntil = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  saveDB();
  $('#reminderOverlay').hidden = true;
  toast('已设为 10 分钟后再次提醒');
}
function takenFromReminder(){
  var ov = $('#reminderOverlay');
  var med = getMed(ov.dataset.medId);
  var time = ov.dataset.time || nowHM();
  ov.hidden = true;
  if(!med) return;
  checkin(med, time);
}

/* ================================================================
 * 打卡
 * ================================================================ */
function checkin(med, time){
  var dose = Math.max(1, med.dosePerTime || 1);
  med.stock = Math.max(0, (med.stock || 0) - dose);
  DB.logs.push({ id: uid(), date: todayStr(), medId: med.id, time: time || nowHM(), dose: dose });
  saveDB();
  render();
  toast('已打卡 ✓ ' + med.name + ' -' + dose + med.unit + '（剩余 ' + med.stock + med.unit + '）');
}
function undoLog(logId){
  var i = DB.logs.findIndex(function(l){ return l.id === logId; });
  if(i < 0) return;
  var l = DB.logs[i];
  var med = getMed(l.medId);
  if(med){ med.stock = (med.stock || 0) + l.dose; }
  DB.logs.splice(i, 1);
  saveDB();
  render();
  toast('已撤销该次打卡');
}

/* ================================================================
 * 拍照 / 图片处理
 * ================================================================ */
function pickPhoto(capture){
  var input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  if(capture) input.setAttribute('capture', 'environment');
  input.onchange = function(){
    var f = this.files && this.files[0];
    if(!f) return;
    var reader = new FileReader();
    reader.onload = function(e){
      compressImage(e.target.result, function(dataUrl){
        state.medPhoto = dataUrl;
        var pv = $('#photoPreview');
        if(pv){ pv.src = dataUrl; pv.hidden = false; }
        var rm = $('#btnRemovePhoto');
        if(rm) rm.hidden = false;
        var hint = $('#photoHint');
        if(hint) hint.hidden = true;
      });
    };
    reader.readAsDataURL(f);
  };
  input.click();
}
function compressImage(dataUrl, cb){
  try{
    var img = new Image();
    img.onload = function(){
      var max = 900;
      var w = img.width, h = img.height;
      var scale = Math.min(1, max / Math.max(w, h));
      var canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      var out = canvas.toDataURL('image/jpeg', 0.72);
      if(out.length > 400000){ out = canvas.toDataURL('image/jpeg', 0.5); }
      cb(out);
    };
    img.onerror = function(){ cb(dataUrl); };
    img.src = dataUrl;
  }catch(e){ cb(dataUrl); }
}

/* ================================================================
 * 本地 OCR（Tesseract.js 中文）
 * ================================================================ */
var ocrWorker = null;
var ocrLoading = false;

function loadOcrScript(cb){
  if(window.Tesseract){ cb(null); return; }
  var s = document.createElement('script');
  s.src = 'ocr/tesseract.min.js';
  s.onload = function(){ cb(null); };
  s.onerror = function(){ cb(new Error('识别组件加载失败')); };
  document.head.appendChild(s);
}
function ocrBar(text, cls){
  var bar = $('#ocrBar');
  if(!bar) return;
  if(cls === 'loading'){
    bar.className = 'ocr-bar';
    bar.innerHTML = '<span class="spinner"></span>' + text;
  } else {
    bar.className = 'ocr-bar ' + (cls||'');
    bar.innerHTML = (cls === 'ok' ? '✓ ' : cls === 'err' ? '✗ ' : '') + text;
  }
}
function runOcr(){
  var dataUrl = state.medPhoto;
  if(!dataUrl){ toast('请先拍照或选择药品照片'); return; }
  ocrBar('正在加载中文识别模型（约 20MB，首次稍慢）…', 'loading');
  loadOcrScript(function(err){
    if(err){ ocrBar('OCR 组件加载失败：' + err.message, 'err'); return; }
    var base = location.href.substring(0, location.href.lastIndexOf('/') + 1);
    var opts = {
      workerPath: base + 'ocr/worker.min.js',
      corePath: base + 'ocr/core/tesseract-core-lstm.wasm.js',
      langPath: base + 'ocr',
      gzip: true,
      workerBlobURL: false,
      logger: function(m){
        if(m.status === 'recognizing text'){
          var pct = Math.round((m.progress||0) * 100);
          if(pct % 10 === 0) ocrBar('正在识别文字… ' + pct + '%', 'loading');
        } else if(m.status === 'loading tesseract core'){
          ocrBar('正在初始化识别引擎…', 'loading');
        }
      }
    };
    ocrLoading = true;
    try{
      Tesseract.createWorker('chi_sim', 1, opts).then(function(worker){
        ocrWorker = worker;
        return worker.recognize(dataUrl);
      }).then(function(res){
        ocrLoading = false;
        var text = (res && res.data && res.data.text) || '';
        handleOcrResult(text);
      }).catch(function(e){
        ocrLoading = false;
        console.error('OCR error', e);
        ocrBar('识别失败：' + (e && e.message ? e.message : '未知错误') + '（可直接手动填写药名）', 'err');
      });
    }catch(e){
      ocrLoading = false;
      ocrBar('当前环境不支持本地识别，可直接手动填写', 'err');
    }
  });
}
/* 从 OCR 文本中提取药名 / 效期 */
function extractMedInfo(text){
  var lines = text.split('\n').map(function(s){ return s.trim(); }).filter(Boolean);
  var name = '', expire = '';
  var kw = /(胶囊|缓释|肠溶|分散片|泡腾|颗粒|口服液|糖浆|滴丸|软膏|乳膏|贴膏|滴眼液|喷雾|片$|丸$|剂$)/;
  for(var i=0;i<lines.length;i++){
    var line = lines[i].replace(/\s+/g,'');
    if(line.length > 1 && line.length <= 24 && kw.test(line)){
      name = line;
      break;
    }
  }
  if(!name){
    for(var j=0;j<lines.length;j++){
      var l2 = lines[j].replace(/\s+/g,'');
      if(/^[\u4e00-\u9fa5A-Za-z]{2,14}$/.test(l2) && !/^(有限公司|制药|生产|批准|适应|用法|用量|贮藏|规格)/.test(l2)){
        name = l2; break;
      }
    }
  }
  var m = text.match(/20\d{2}\s*[年.\-/]\s*\d{1,2}\s*[月.\-/]\s*\d{1,2}/);
  if(m){
    var parts = m[0].split(/[年.\-\/月]+/);
    expire = parts[0] + '-' + pad2(parseInt(parts[1],10)) + '-' + pad2(parseInt(parts[2],10));
  }
  return { name: name, expire: expire, lines: lines };
}
function handleOcrResult(text){
  var info = extractMedInfo(text);
  var hits = [];
  var KW = /(胶囊|缓释|肠溶|分散片|泡腾|颗粒|口服液|糖浆|滴丸|软膏|乳膏|贴膏|滴眼液|喷雾)/;
  var SUFFIX = /(片|丸|剂|膏|液|浆)$/;
  // 药名候选：纯文字（2-12 字符）、含药名关键词或以剂型结尾、排除含数字/标点
  var names = info.lines.map(function(l){ return l.replace(/\s+/g,''); })
    .filter(function(l){
      if(l.length < 2 || l.length > 12) return false;
      if(/[：:：]/.test(l)) return false;
      if(/\d/.test(l)) return false;
      if(/[×xX*]/.test(l)) return false;
      if(/^(用于|适应|用法|用量|贮藏|规格|批准|生产|有效期|复诊|医生|每日|每次)/.test(l)) return false;
      return KW.test(l) || SUFFIX.test(l) || /^[\u4e00-\u9fa5]{2,10}$/.test(l);
    });
  names = names.slice(0, 6);
  if(info.name && names.indexOf(info.name) < 0) names.unshift(info.name);
  hits = names;
  ocrBar('识别完成，点击候选药名填入表单', 'ok');
  var box = $('#ocrResult');
  box.innerHTML = '';
  box.hidden = false;
  var pre = document.createElement('div');
  pre.className = 'ocr-result';
  pre.textContent = text.slice(0, 600);
  box.appendChild(pre);
  if(hits.length){
    var hitsDiv = document.createElement('div');
    hitsDiv.className = 'ocr-hits';
    hits.forEach(function(nm){
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'ocr-hit';
      b.textContent = nm;
      b.addEventListener('click', function(){
        var f = $('#f_name');
        if(f) f.value = nm;
        toast('已填入药名：' + nm);
      });
      hitsDiv.appendChild(b);
    });
    box.appendChild(hitsDiv);
  }
  if(info.expire){
    var f = $('#f_expiry');
    if(f){ f.value = info.expire; toast('已识别效期：' + fmtDate(info.expire)); }
  }
  if(!info.name && !info.expire){
    ocrBar('未识别出药名/效期，可查看文字手动填写', 'err');
  }
}

/* ================================================================
 * 渲染：今日
 * ================================================================ */
function renderToday(){
  var t = todayStr();
  var enabledMeds = DB.meds.filter(function(m){ return m.reminderEnabled || (m.reminderTimes && m.reminderTimes.length); });
  var tasks = [];
  enabledMeds.forEach(function(med){
    if(med.reminderTimes && med.reminderTimes.length){
      med.reminderTimes.forEach(function(rt){ tasks.push({ med: med, time: rt, key: rt }); });
    } else {
      tasks.push({ med: med, time: '', key: '' });
    }
  });
  tasks.sort(function(a,b){ return (a.time||'99:99').localeCompare(b.time||'99:99'); });

  var doneCount = DB.logs.filter(function(l){ return l.date === t; }).length;
  var needCount = tasks.length;
  var pct = needCount ? Math.round(doneCount / needCount * 100) : 100;
  var warns = countWarns();

  $('#summaryCards').innerHTML =
    '<div class="s-card ' + (pct >= 100 ? 'good' : pct >= 50 ? 'mid' : 'bad') + '">' +
      '<div class="s-ico">' + ico('check') + '</div>' +
      '<div class="num">' + doneCount + '/' + needCount + '</div><div class="lab">今日已服/应服</div></div>' +
    '<div class="s-card ' + (pct >= 100 ? 'good' : pct >= 50 ? 'mid' : 'bad') + '">' +
      '<div class="s-ico">' + ico('chart') + '</div>' +
      '<div class="num">' + pct + '%</div><div class="lab">今日依从率</div></div>' +
    '<div class="s-card ' + (warns > 0 ? 'bad' : 'good') + '">' +
      '<div class="s-ico">' + ico('alert') + '</div>' +
      '<div class="num">' + warns + '</div><div class="lab">待处理预警</div></div>';

  var alerts = [];
  DB.meds.forEach(function(med){
    var dl = daysUntil(med.expiryDate);
    if(med.expiryDate && dl < 0){
      alerts.push({ cls:'danger', txt: med.name + ' 已过期 ' + (-dl) + ' 天，请勿服用！' });
    } else if(med.expiryDate && dl <= 30){
      alerts.push({ cls:'warn', txt: med.name + ' 将在 ' + dl + ' 天后到期（' + fmtDate(med.expiryDate) + '）' });
    }
    if(med.stock <= med.refillThreshold){
      alerts.push({ cls:'warn', txt: med.name + ' 库存不足（剩 ' + med.stock + med.unit + '），该备药了' });
    }
  });
  DB.doctors.forEach(function(doc){
    var dl = daysUntil(doc.nextVisit);
    if(doc.nextVisit && dl >= 0 && dl <= 7){
      alerts.push({ cls:'warn', txt: dl + ' 天后复诊（' + doc.name + ' @ ' + (doc.hospital||'') + '）' });
    }
  });
  if(alerts.length === 0 && needCount > 0 && doneCount >= needCount){
    alerts.push({ cls:'ok', txt:'今日用药已完成，继续保持！' });
  }
  if(alerts.length === 0 && needCount === 0){
    alerts.push({ cls:'info', txt:'还没有待服药品，去"药品"页添加，或先拍照识别录入' });
  }
  var iconMap = { warn:'alert', danger:'alert', ok:'check', info:'bell' };
  $('#alertBox').innerHTML = alerts.map(function(a){
    return '<div class="alert ' + a.cls + '">' + ico(iconMap[a.cls]) + '<span>' + a.txt + '</span></div>';
  }).join('');

  if(tasks.length === 0){
    $('#todayTasks').innerHTML = '<div class="empty"><div class="e-ico">' + ico('pill') + '</div>暂无待服任务<br>点击药品页 ＋ 添加，或拍照识别录入</div>';
  } else {
    $('#todayTasks').innerHTML = tasks.map(function(task){
      var med = task.med;
      var done = isChecked(med.id, task.key);
      var remain = stockDays(med);
      return '<div class="task ' + (done ? 'done' : '') + '">' +
        '<div class="t-pill">' + ico('pill') + '</div>' +
        '<div class="t-time">' + (task.time ? task.time : '全天') + '</div>' +
        '<div class="t-body">' +
          '<div class="t-name">' + escapeHtml(med.name) + '</div>' +
          '<div class="t-sub">' + (med.dosePerTime||1) + med.unit + '<span class="dot"></span>剩 ' + (med.stock||0) + med.unit +
            (remain != null ? '<span class="dot"></span>约剩 ' + remain + ' 天' : '') + '</div>' +
        '</div>' +
        '<button class="t-check" data-med="' + med.id + '" data-time="' + (task.time||'') + '">' + (done ? ico('check') : ico('plus')) + '</button>' +
      '</div>';
    }).join('');
  }

  var logs = DB.logs.filter(function(l){ return l.date === t; })
    .sort(function(a,b){ return b.time.localeCompare(a.time); });
  $('#todayLogs').innerHTML = logs.length === 0
    ? '<div class="empty"><div class="e-ico">' + ico('clock') + '</div>今天还没有打卡记录</div>'
    : logs.map(function(l){
        var med = getMed(l.medId);
        return '<div class="item-row">' +
          '<div class="item-ava" style="background:' + (med ? med.color || colorOf(med.id) : '#94a3b8') + '">' + (med ? escapeHtml(med.name[0]) : '?') + '</div>' +
          '<div class="item-info"><div class="item-name">' + escapeHtml(med ? med.name : '已删除药品') + '</div>' +
          '<div class="item-sub">' + l.time + ' · 服用 ' + l.dose + (med ? med.unit : '') + '</div></div>' +
          '<button class="item-del" data-undo="' + l.id + '">撤销</button></div>';
      }).join('');
}

function countWarns(){
  var n = 0;
  DB.meds.forEach(function(med){
    var dl = daysUntil(med.expiryDate);
    if(med.expiryDate && dl <= 30) n++;
    if(med.stock <= med.refillThreshold) n++;
  });
  DB.doctors.forEach(function(doc){
    var dl = daysUntil(doc.nextVisit);
    if(doc.nextVisit && dl >= 0 && dl <= 7) n++;
  });
  return n;
}

/* ================================================================
 * 渲染：药品
 * ================================================================ */
var CATS = ['全部','感冒发热','肠胃','心血管','糖尿病','高血压','抗生素','止痛','维生素/保健','皮肤外用','其他'];
var RISK_TAGS = ['可能嗜睡','避免饮酒','空腹服用','饭后服用','孕妇慎用','避免驾驶','与食物同服','可能升血压'];
var UNITS = ['片','粒','ml','袋','支','贴'];

function renderMeds(){
  var kw = state.search.trim().toLowerCase();
  var list = DB.meds.filter(function(m){
    if(state.cat !== '全部' && m.category !== state.cat) return false;
    if(kw && m.name.toLowerCase().indexOf(kw) < 0 && (m.notes||'').toLowerCase().indexOf(kw) < 0) return false;
    return true;
  });
  $('#medSearch').value = state.search;
  $('#catChips').innerHTML = CATS.map(function(c){
    return '<button class="chip ' + (state.cat === c ? 'on' : '') + '" data-cat="' + c + '">' + c + '</button>';
  }).join('');

  if(list.length === 0){
    $('#medList').innerHTML = '<div class="empty"><div class="e-ico">' + ico('search') + '</div>没有找到药品</div>';
    return;
  }
  $('#medList').innerHTML = list.map(function(m){
    var dl = daysUntil(m.expiryDate);
    var remain = stockDays(m);
    var tag = '';
    if(m.expiryDate && dl < 0) tag = '<span class="tag exp">已过期</span>';
    else if(m.expiryDate && dl <= 30) tag = '<span class="tag warn">' + dl + '天后到期</span>';
    if(m.stock <= m.refillThreshold) tag += '<span class="tag low">库存告急</span>';
    var remainTxt = remain != null ? '约剩 ' + remain + ' 天' : '按量服用';
    var thumb = m.photo
      ? '<img class="med-photo" src="' + m.photo + '" alt="' + escapeHtml(m.name) + '">'
      : '<div class="med-ico" style="background:' + (m.color || colorOf(m.id)) + '">' + escapeHtml(m.name[0]) + '</div>';
    return '<div class="med-item" data-med="' + m.id + '">' +
      thumb +
      '<div class="med-body">' +
        '<div class="med-name">' + escapeHtml(m.name) + ' <span class="tag med">' + escapeHtml(m.category||'其他') + '</span>' + tag + '</div>' +
        '<div class="med-sub">' + escapeHtml(m.spec||'') + ' · 每次' + (m.dosePerTime||1) + m.unit + ' × 每日' + dailyTimes(m) + '次' +
          (m.memberId ? ' · ' + escapeHtml(memberName(m.memberId)) : '') + '</div>' +
      '</div>' +
      '<div class="med-right"><div class="med-stock">' + (m.stock||0) + m.unit + '</div>' +
      '<div class="med-left">' + remainTxt + '</div></div></div>';
  }).join('');
}

/* ================================================================
 * 渲染：日历
 * ================================================================ */
function renderCal(){
  var y = state.calYear, m = state.calMonth;
  $('#calTitle').textContent = y + '年' + (m+1) + '月';
  var first = new Date(y, m, 1);
  var daysInMonth = new Date(y, m+1, 0).getDate();
  var lead = (first.getDay() + 6) % 7;
  var wds = ['一','二','三','四','五','六','日'];
  var html = wds.map(function(w){ return '<div class="cal-wd">' + w + '</div>'; }).join('');
  var today = todayStr();
  for(var i=0;i<lead;i++) html += '<div class="cal-day other"></div>';
  for(var d=1;d<=daysInMonth;d++){
    var ds = y + '-' + pad2(m+1) + '-' + pad2(d);
    var cnt = DB.logs.filter(function(l){ return l.date === ds; }).length;
    var cls = 'cal-day';
    if(ds === today) cls += ' today';
    if(ds === state.calDay) cls += ' sel';
    var dots = '';
    if(cnt > 0) dots = '<div class="dots">' + (cnt > 3 ? '<i></i><i></i><i></i>' : new Array(cnt+1).join('<i></i>')) + '</div>';
    html += '<div class="' + cls + '" data-day="' + ds + '">' + d + dots + '</div>';
  }
  $('#calGrid').innerHTML = html;

  var logs = DB.logs.filter(function(l){ return l.date === state.calDay; })
    .sort(function(a,b){ return b.time.localeCompare(a.time); });
  var d = new Date(state.calDay.replace(/-/g,'/'));
  $('#calDayTitle').textContent = (parseInt(state.calDay.split('-')[1],10)) + '月' + parseInt(state.calDay.split('-')[2],10) + '日 ' + weekdayCN(d) + ' 记录';
  $('#calDayLogs').innerHTML = logs.length === 0
    ? '<div class="empty">当天无打卡记录</div>'
    : logs.map(function(l){
        var med = getMed(l.medId);
        return '<div class="item-row">' +
          '<div class="item-ava" style="background:' + (med ? med.color || colorOf(med.id) : '#94a3b8') + '">' + (med ? escapeHtml(med.name[0]) : '?') + '</div>' +
          '<div class="item-info"><div class="item-name">' + escapeHtml(med ? med.name : '已删除药品') + '</div>' +
          '<div class="item-sub">' + l.time + ' · ' + l.dose + (med ? med.unit : '') + '</div></div>' +
          '<button class="item-del" data-undo="' + l.id + '">撤销</button></div>';
      }).join('');
}

/* ================================================================
 * 统计
 * ================================================================ */
function statRange(days){
  var list = [];
  for(var i=0;i<days;i++){
    var d = new Date(); d.setDate(d.getDate() - i);
    list.push(d.getFullYear() + '-' + pad2(d.getMonth()+1) + '-' + pad2(d.getDate()));
  }
  var need = 0, done = 0;
  list.forEach(function(ds){
    need += DB.meds.reduce(function(s, m){ return s + dailyTimes(m); }, 0);
    done += DB.logs.filter(function(l){ return l.date === ds; }).length;
  });
  return { need: need, done: done, pct: need ? Math.round(done/need*100) : 100 };
}
function streakDays(){
  var n = 0;
  for(var i=0;;i++){
    var d = new Date(); d.setDate(d.getDate() - i);
    var ds = d.getFullYear() + '-' + pad2(d.getMonth()+1) + '-' + pad2(d.getDate());
    var cnt = DB.logs.filter(function(l){ return l.date === ds; }).length;
    if(cnt > 0) n++; else if(i === 0) continue; else break;
    if(i > 730) break;
  }
  return n;
}
function renderStat(){
  var s7 = statRange(7), s30 = statRange(30);
  var streak = streakDays();
  var total = DB.logs.length;
  $('#statCards').innerHTML =
    '<div class="stat-card"><div class="v" style="color:var(--ok)">' + s7.pct + '%</div><div class="k">近 7 天依从率</div></div>' +
    '<div class="stat-card"><div class="v" style="color:var(--primary)">' + s30.pct + '%</div><div class="k">近 30 天依从率</div></div>' +
    '<div class="stat-card"><div class="v" style="color:var(--warn)">' + streak + ' 天</div><div class="k">连续打卡</div></div>' +
    '<div class="stat-card"><div class="v" style="color:var(--danger)">' + total + ' 次</div><div class="k">累计打卡</div></div>';

  var days = [], cnts = [];
  for(var i=13;i>=0;i--){
    var d = new Date(); d.setDate(d.getDate() - i);
    var ds = d.getFullYear() + '-' + pad2(d.getMonth()+1) + '-' + pad2(d.getDate());
    days.push((d.getMonth()+1) + '/' + d.getDate());
    cnts.push(DB.logs.filter(function(l){ return l.date === ds; }).length);
  }
  $('#trendChart').innerHTML = barChart(days, cnts, '次');

  var meds = DB.meds.slice();
  if(meds.length){
    var names = [], vals = [], cols = [];
    meds.forEach(function(m){ names.push(m.name); vals.push(m.stock||0); cols.push(m.color || colorOf(m.id)); });
    $('#stockChart').innerHTML = hBarChart(names, vals, cols, DB.meds.length > 4 ? '（滑动查看）' : '');
  } else {
    $('#stockChart').innerHTML = '<div class="empty">暂无药品</div>';
  }

  var catMap = {};
  DB.logs.forEach(function(l){
    var med = getMed(l.medId);
    var c = med ? (med.category || '其他') : '其他';
    catMap[c] = (catMap[c] || 0) + 1;
  });
  var keys = Object.keys(catMap);
  if(keys.length){
    keys.sort(function(a,b){ return catMap[b] - catMap[a]; });
    var cNames = keys, cVals = keys.map(function(k){ return catMap[k]; });
    $('#catChart').innerHTML = hBarChart(cNames, cVals, keys.map(function(k){ return colorOf(k); }), '');
  } else {
    $('#catChart').innerHTML = '<div class="empty">暂无打卡数据</div>';
  }
}

function barChart(labels, vals, unit){
  var W = 460, H = 170, padL = 26, padB = 26, padT = 16;
  var max = Math.max.apply(null, vals.concat([1]));
  var n = vals.length, bw = (W - padL - 8) / n;
  var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '">';
  var gridMax = Math.ceil(max / 4) * 4 || 4;
  for(var g=0; g<=4; g++){
    var gy = padT + (H - padT - padB) * (1 - g/4);
    svg += '<line x1="' + padL + '" y1="' + gy + '" x2="' + (W-6) + '" y2="' + gy + '" stroke="var(--line)" stroke-width="1"/>';
    svg += '<text x="' + (padL-6) + '" y="' + (gy+3) + '" text-anchor="end" class="axis-text">' + Math.round(gridMax*g/4) + '</text>';
  }
  vals.forEach(function(v, i){
    var bh = (H - padT - padB) * (v / gridMax);
    var x = padL + i*bw + bw*0.18, y = H - padB - bh;
    svg += '<rect x="' + x + '" y="' + y + '" width="' + (bw*0.64) + '" height="' + Math.max(bh, v>0?2:0) + '" rx="3" fill="url(#gradBar)" opacity="' + (v>0?0.95:0.25) + '"/>';
    svg += '<text x="' + (x + bw*0.32) + '" y="' + (H-padB+12) + '" text-anchor="middle" class="bar-label">' + labels[i] + '</text>';
    if(v > 0) svg += '<text x="' + (x + bw*0.32) + '" y="' + (y-4) + '" text-anchor="middle" class="bar-label" font-weight="bold">' + v + '</text>';
  });
  svg += '<defs><linearGradient id="gradBar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6366f1"/><stop offset="1" stop-color="#3b82f6"/></linearGradient></defs></svg>';
  return svg;
}
function hBarChart(names, vals, cols, note){
  var W = 460, rowH = 34, padL = 96, padR = 46;
  var H = names.length * rowH + 14;
  var max = Math.max.apply(null, vals.concat([1]));
  var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="min-width:' + Math.min(W, 300 + names.length*10) + 'px">';
  names.forEach(function(nm, i){
    var y = 14 + i*rowH;
    svg += '<text x="' + (padL-10) + '" y="' + (y+14) + '" text-anchor="end" class="bar-label" font-weight="600">' + escapeHtml(nm.length>5?nm.slice(0,5)+'…':nm) + '</text>';
    var bw = (W - padL - padR) * (vals[i] / max);
    svg += '<rect x="' + padL + '" y="' + y + '" width="' + Math.max(bw, vals[i]>0?2:0) + '" height="18" rx="4" fill="' + cols[i] + '"/>';
    svg += '<text x="' + (padL + bw + 6) + '" y="' + (y+14) + '" class="bar-label" font-weight="bold">' + vals[i] + '</text>';
  });
  svg += '</svg>';
  return svg + (note ? '<div class="hint">' + note + '</div>' : '');
}

/* ================================================================
 * 渲染：我的
 * ================================================================ */
function renderMine(){
  $('#memberList').innerHTML = DB.members.map(function(m){
    var cnt = DB.meds.filter(function(x){ return x.memberId === m.id; }).length;
    return '<div class="item-row">' +
      '<div class="item-ava" style="background:' + (m.color||'#3b82f6') + '">' + escapeHtml(m.name[0]) + '</div>' +
      '<div class="item-info"><div class="item-name">' + escapeHtml(m.name) + '</div>' +
      '<div class="item-sub">' + escapeHtml(m.relation||'') + ' · ' + cnt + ' 种药品</div></div>' +
      (m.id !== 'me' ? '<button class="item-del" data-memdel="' + m.id + '">删除</button>' : '') +
      '</div>';
  }).join('') || '<div class="hint">暂无成员</div>';

  $('#doctorList').innerHTML = DB.doctors.map(function(d){
    var dl = daysUntil(d.nextVisit);
    var sub = (d.hospital||'') + (d.dept ? ' · ' + d.dept : '');
    if(d.nextVisit) sub += ' · 复诊 ' + fmtDate(d.nextVisit) + (dl>=0 ? '（剩' + dl + '天）' : '（已过' + (-dl) + '天）');
    return '<div class="item-row">' +
      '<div class="item-ava" style="background:#0ea5e9">' + escapeHtml(d.name[0]) + '</div>' +
      '<div class="item-info"><div class="item-name">' + escapeHtml(d.name) + '</div>' +
      '<div class="item-sub">' + escapeHtml(sub) + '</div></div>' +
      '<button class="item-del" data-docedit="' + d.id + '">编辑</button>' +
      '<button class="item-del" data-docdel="' + d.id + '">删除</button></div>';
  }).join('') || '<div class="hint">暂无医生信息</div>';

  $('#swDark').checked = !!DB.settings.dark;
  $('#swSound').checked = !!DB.settings.sound;
  $('#swNotify').checked = !!DB.settings.notify;
}

/* ================================================================
 * 弹窗通用
 * ================================================================ */
function openModal(html){
  $('#modal').innerHTML = html;
  $('#modalMask').hidden = false;
}
function closeModal(){ $('#modalMask').hidden = true; }

/* ---------------- 药品表单（含拍照识别） ---------------- */
function medFormHTML(med){
  med = med || {};
  var times = med.reminderTimes || ['08:00','20:00'];
  var timeChips = ['06:00','08:00','12:00','14:00','18:00','20:00','22:00'].map(function(t){
    return '<button type="button" class="time-chip ' + (times.indexOf(t)>=0?'on':'') + '" data-t="' + t + '">' + t + '</button>';
  }).join('');
  var riskHTML = RISK_TAGS.map(function(t){
    return '<button type="button" class="time-chip ' + ((med.riskTags||[]).indexOf(t)>=0?'on':'') + '" data-r="' + t + '">' + t + '</button>';
  }).join('');
  var memberOpts = DB.members.map(function(m){
    return '<option value="' + m.id + '" ' + (med.memberId===m.id?'selected':'') + '>' + escapeHtml(m.name) + '</option>';
  }).join('');
  var catOpts = CATS.filter(function(c){return c!=='全部';}).map(function(c){
    return '<option ' + (med.category===c?'selected':'') + '>' + c + '</option>';
  }).join('');
  var unitOpts = UNITS.map(function(u){
    return '<option ' + (med.unit===u?'selected':'') + '>' + u + '</option>';
  }).join('');
  var dd = med.dailyDose != null ? med.dailyDose : (med.dosePerTime||1) * dailyTimes(med);
  var photo = med.photo || state.medPhoto;
  return '<h3>' + (med.id ? '编辑药品' : '添加药品') + '<button class="close-x" data-close>✕</button></h3>' +
    /* 拍照识别区 */
    '<div class="form-group"><label>📷 拍照识别药品（可选）</label>' +
      '<div class="photo-zone">' +
        (photo ? '<img class="photo-preview" id="photoPreview" src="' + photo + '">'
               : '<img class="photo-preview" id="photoPreview" hidden>') +
        '<div class="photo-actions">' +
          '<button type="button" class="photo-btn primary" id="btnTakePhoto">' + ico('camera') + '拍照识别</button>' +
          '<button type="button" class="photo-btn" id="btnPickPhoto">' + ico('image') + '从相册选择</button>' +
          (photo ? '' : '<div class="hint" id="photoHint" style="margin:0">拍下药盒/药瓶，自动识别药名与有效期</div>') +
        '</div>' +
      '</div>' +
      '<button type="button" class="mini-btn" id="btnRemovePhoto" ' + (photo ? '' : 'hidden') + '>移除照片</button>' +
      '<div id="ocrBar" class="ocr-bar" hidden></div>' +
      '<div id="ocrResult" hidden></div>' +
    '</div>' +
    '<div class="form-group"><label>药品名称 *</label><input class="input" id="f_name" placeholder="如：布洛芬缓释胶囊" value="' + escapeHtml(med.name||'') + '"></div>' +
    '<div class="form-row">' +
      '<div class="form-group"><label>分类</label><select id="f_cat">' + catOpts + '</select></div>' +
      '<div class="form-group"><label>归属成员</label><select id="f_member">' + memberOpts + '</select></div>' +
    '</div>' +
    '<div class="form-group"><label>规格说明</label><input class="input" id="f_spec" placeholder="如：0.3g × 20粒 / 5mg/片" value="' + escapeHtml(med.spec||'') + '"></div>' +
    '<div class="form-row">' +
      '<div class="form-group"><label>库存数量 *</label><input class="input" id="f_stock" type="number" min="0" value="' + (med.stock||'') + '"></div>' +
      '<div class="form-group"><label>单位</label><select id="f_unit">' + unitOpts + '</select></div>' +
    '</div>' +
    '<div class="form-row">' +
      '<div class="form-group"><label>每次剂量</label><input class="input" id="f_dose" type="number" min="0.1" step="0.1" value="' + (med.dosePerTime!=null?med.dosePerTime:1) + '"></div>' +
      '<div class="form-group"><label>每日次数</label><input class="input" id="f_times" type="number" min="1" value="' + (med.timesPerDay!=null?med.timesPerDay:1) + '"></div>' +
    '</div>' +
    '<div class="form-group"><label>每日总剂量（自动=每次×次数，可改，用于推算剩余天数）</label><input class="input" id="f_daily" type="number" min="0" step="0.1" value="' + dd + '"></div>' +
    '<div class="form-group"><label>服药提醒时间（可多选）</label><div class="time-chips" id="timeChips">' + timeChips + '</div>' +
      '<div class="btn-row"><input class="input" id="f_timeAdd" type="time" style="width:110px">' +
      '<button type="button" class="mini-btn" id="btnAddTime">＋ 添加</button></div></div>' +
    '<div class="form-row">' +
      '<div class="form-group"><label>有效期至</label><input class="input" id="f_expiry" type="date" value="' + (med.expiryDate||'') + '"></div>' +
      '<div class="form-group"><label>库存预警线</label><input class="input" id="f_threshold" type="number" min="0" value="' + (med.refillThreshold!=null?med.refillThreshold:3) + '"></div>' +
    '</div>' +
    '<div class="form-group"><label>风险标签（用药提示）</label><div class="time-chips" id="riskChips">' + riskHTML + '</div></div>' +
    '<div class="form-group"><label>用法用量/注意事项</label><textarea id="f_notes" placeholder="如：饭后服用，忌饮酒，整粒吞服…">' + escapeHtml(med.notes||'') + '</textarea></div>' +
    '<div class="form-group"><label class="switch-row" style="border:none"><span>开启定时提醒</span><input type="checkbox" id="f_remind" ' + (med.reminderEnabled!==false?'checked':'') + '><i></i></label></div>' +
    '<button class="btn btn-primary" id="btnSaveMed">保存</button>' +
    (med.id ? '<button class="btn btn-danger" id="btnDelMed" style="margin-top:8px">删除该药品</button>' : '');
}
function medFormTimeSet(){
  var sel = [];
  $('#timeChips').querySelectorAll('.time-chip.on').forEach(function(c){ sel.push(c.dataset.t); });
  $('#timeChips').addEventListener('click', function(e){
    var b = e.target.closest('.time-chip');
    if(!b || b.dataset.r) return;
    if(b.dataset.t === undefined) return;
    var t = b.dataset.t;
    if(b.classList.contains('on')){ b.classList.remove('on'); sel = sel.filter(function(x){return x!==t;}); }
    else { b.classList.add('on'); sel.push(t); }
  });
  function renderChips(){
    $('#timeChips').innerHTML = sel.map(function(t){
      return '<button type="button" class="time-chip on" data-t="' + t + '">' + t + '</button>';
    }).join('');
  }
  $('#f_timeAdd').addEventListener('change', function(){
    var v = this.value;
    if(v && sel.indexOf(v) < 0){ sel.push(v); renderChips(); }
  });
  $('#btnAddTime').addEventListener('click', function(){
    var v = $('#f_timeAdd').value;
    if(v && sel.indexOf(v) < 0){ sel.push(v); renderChips(); }
  });
  $('#riskChips').addEventListener('click', function(e){
    var b = e.target.closest('.time-chip');
    if(!b || b.dataset.t !== undefined) return;
    b.classList.toggle('on');
  });
  /* 拍照 / OCR 事件 */
  var takeBtn = $('#btnTakePhoto');
  if(takeBtn) takeBtn.addEventListener('click', function(){ pickPhoto(true); });
  var pickBtn = $('#btnPickPhoto');
  if(pickBtn) pickBtn.addEventListener('click', function(){ pickPhoto(false); });
  var rmBtn = $('#btnRemovePhoto');
  if(rmBtn) rmBtn.addEventListener('click', function(){
    state.medPhoto = null;
    var pv = $('#photoPreview'); if(pv){ pv.hidden = true; pv.src = ''; }
    rmBtn.hidden = true;
    $('#ocrBar').hidden = true;
    $('#ocrResult').hidden = true;
    var hint = $('#photoHint'); if(hint) hint.hidden = false;
  });
  /* 照片选择后自动开始识别 */
  var obs = null;
  function bindAutoOcr(){
    var pv = $('#photoPreview');
    if(!pv) return;
    if(obs){ obs.disconnect(); }
    obs = new MutationObserver(function(){
      if(!pv.hidden && !ocrLoading){
        runOcr();
        if(obs) obs.disconnect();
      }
    });
    obs.observe(pv, { attributes: true, attributeFilter: ['src'] });
  }
  bindAutoOcr();
}
function openMedForm(med){
  state.medPhoto = null;
  openModal(medFormHTML(med));
  medFormTimeSet();
  $('#btnSaveMed').addEventListener('click', function(){
    var name = $('#f_name').value.trim();
    var stock = parseFloat($('#f_stock').value);
    if(!name){ toast('请填写药品名称'); return; }
    if(isNaN(stock) || stock < 0){ toast('请填写正确的库存数量'); return; }
    var sel = [];
    $('#timeChips').querySelectorAll('.time-chip.on').forEach(function(c){ sel.push(c.dataset.t); });
    var risks = [];
    $('#riskChips').querySelectorAll('.time-chip.on').forEach(function(c){ risks.push(c.dataset.r); });
    var daily = parseFloat($('#f_daily').value);
    var data = {
      name: name,
      category: $('#f_cat').value,
      memberId: $('#f_member').value,
      spec: $('#f_spec').value.trim(),
      stock: stock,
      unit: $('#f_unit').value,
      dosePerTime: parseFloat($('#f_dose').value) || 1,
      timesPerDay: parseInt($('#f_times').value,10) || 1,
      dailyDose: isNaN(daily) ? null : daily,
      reminderEnabled: $('#f_remind').checked,
      reminderTimes: sel,
      expiryDate: $('#f_expiry').value,
      refillThreshold: parseFloat($('#f_threshold').value) || 0,
      riskTags: risks,
      notes: $('#f_notes').value.trim()
    };
    if(state.medPhoto) data.photo = state.medPhoto;
    if(med && med.id){
      var m = getMed(med.id);
      Object.assign(m, data);
      toast('已保存 ' + m.name);
    } else {
      data.id = uid();
      data.color = colorOf(data.name);
      data.createdAt = Date.now();
      DB.meds.push(data);
      toast('已添加 ' + data.name);
    }
    saveDB(); closeModal(); render();
  });
  var delBtn = $('#btnDelMed');
  if(delBtn) delBtn.addEventListener('click', function(){
    if(!confirm('确定删除「' + med.name + '」？相关打卡记录将保留。')) return;
    DB.meds = DB.meds.filter(function(m){ return m.id !== med.id; });
    saveDB(); closeModal(); render(); toast('已删除');
  });
}
function openMedDetail(med){
  var remain = stockDays(med);
  var risks = (med.riskTags||[]).length ? med.riskTags.map(function(r){ return '<span class="tag warn" style="margin-right:4px">' + r + '</span>'; }).join('') : '无';
  var photoHtml = med.photo
    ? '<img src="' + med.photo + '" style="width:100%;max-height:180px;object-fit:cover;border-radius:14px;margin-bottom:12px;border:1px solid var(--line)">'
    : '';
  openModal('<h3>' + escapeHtml(med.name) + '<button class="close-x" data-close>✕</button></h3>' +
    photoHtml +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">' +
      '<span class="tag med">' + escapeHtml(med.category||'其他') + '</span>' +
      '<span class="tag med">' + escapeHtml(memberName(med.memberId)) + '</span>' +
      (med.reminderEnabled && med.reminderTimes.length ? med.reminderTimes.map(function(t){return '<span class="tag ok">⏰ ' + t + '</span>';}).join('') : '<span class="tag warn">未设提醒</span>') +
    '</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">' +
      '<div class="card" style="margin:0;box-shadow:none;background:var(--card-2)"><div class="num" style="font-size:22px;font-weight:800">' + (med.stock||0) + med.unit + '</div><div class="lab" style="font-size:12px;color:var(--sub)">当前库存</div></div>' +
      '<div class="card" style="margin:0;box-shadow:none;background:var(--card-2)"><div class="num" style="font-size:22px;font-weight:800">' + (remain != null ? remain + ' 天' : '—') + '</div><div class="lab" style="font-size:12px;color:var(--sub)">' + (remain != null ? '预计 ' + fmtDate(new Date(Date.now()+remain*86400000).toISOString().slice(0,10)) + ' 用完' : '需设每日剂量') + '</div></div>' +
    '</div>' +
    '<div class="form-group"><label>规格</label><div class="hint" style="margin:0">' + escapeHtml(med.spec||'未填写') + '</div></div>' +
    '<div class="form-group"><label>用法</label><div class="hint" style="margin:0">每次 ' + (med.dosePerTime||1) + med.unit + '，每日 ' + dailyTimes(med) + ' 次（每日 ' + dailyDose(med) + med.unit + '）</div></div>' +
    '<div class="form-group"><label>有效期</label><div class="hint" style="margin:0">' + (med.expiryDate ? fmtDate(med.expiryDate) + (daysUntil(med.expiryDate)<0?'（已过期）':daysUntil(med.expiryDate)<=30?'（即将到期）':'') : '未登记') + '</div></div>' +
    '<div class="form-group"><label>风险标签</label><div>' + risks + '</div></div>' +
    (med.notes ? '<div class="form-group"><label>注意事项</label><div class="hint" style="margin:0">' + escapeHtml(med.notes) + '</div></div>' : '') +
    '<button class="btn btn-primary" id="btnEditMed">编辑药品</button>' +
    '<button class="btn btn-ghost" id="btnCheckNow" style="margin-top:8px">立即打卡一次</button>');
  $('#btnEditMed').addEventListener('click', function(){ openMedForm(med); });
  $('#btnCheckNow').addEventListener('click', function(){ closeModal(); checkin(med, nowHM()); });
}

/* ---------------- 手动记录弹窗 ---------------- */
function openQuickLog(){
  var opts = DB.meds.length ? DB.meds.map(function(m){
    return '<option value="' + m.id + '">' + escapeHtml(m.name) + '（剩 ' + (m.stock||0) + m.unit + '）</option>';
  }).join('') : '<option value="">（请先添加药品）</option>';
  openModal('<h3>手动记录用量<button class="close-x" data-close>✕</button></h3>' +
    '<div class="form-group"><label>药品</label><select id="q_med">' + opts + '</select></div>' +
    '<div class="form-row">' +
      '<div class="form-group"><label>剂量</label><input class="input" id="q_dose" type="number" min="0.1" step="0.1" value="1"></div>' +
      '<div class="form-group"><label>时间</label><input class="input" id="q_time" type="time" value="' + nowHM() + '"></div>' +
    '</div>' +
    '<div class="form-group"><label>日期</label><input class="input" id="q_date" type="date" value="' + todayStr() + '"></div>' +
    '<button class="btn btn-primary" id="btnSaveLog">保存记录</button>');
  $('#btnSaveLog').addEventListener('click', function(){
    var medId = $('#q_med').value;
    var med = getMed(medId);
    if(!med){ toast('请先添加药品'); return; }
    var dose = parseFloat($('#q_dose').value) || 1;
    var date = $('#q_date').value || todayStr();
    var time = $('#q_time').value || nowHM();
    med.stock = Math.max(0, (med.stock||0) - dose);
    DB.logs.push({ id: uid(), date: date, medId: medId, time: time, dose: dose });
    saveDB(); closeModal(); render();
    toast('已记录 ' + date + ' ' + time + ' 服用 ' + dose + med.unit);
  });
}

/* ---------------- 成员弹窗 ---------------- */
function openMemberForm(){
  openModal('<h3>添加成员<button class="close-x" data-close>✕</button></h3>' +
    '<div class="form-group"><label>称呼 *</label><input class="input" id="m_name" placeholder="如：妈妈、孩子"></div>' +
    '<div class="form-group"><label>关系</label><input class="input" id="m_rel" placeholder="如：母亲 / 儿子"></div>' +
    '<button class="btn btn-primary" id="btnSaveMember">保存</button>');
  $('#btnSaveMember').addEventListener('click', function(){
    var name = $('#m_name').value.trim();
    if(!name){ toast('请填写称呼'); return; }
    DB.members.push({ id: uid(), name: name, relation: $('#m_rel').value.trim(), color: PALETTE[DB.members.length % PALETTE.length] });
    saveDB(); closeModal(); renderMine(); render(); toast('已添加成员');
  });
}

/* ---------------- 医生弹窗 ---------------- */
function doctorFormHTML(d){
  d = d || {};
  return '<h3>' + (d.id?'编辑医生':'添加医生') + '<button class="close-x" data-close>✕</button></h3>' +
    '<div class="form-group"><label>医生姓名 *</label><input class="input" id="d_name" value="' + escapeHtml(d.name||'') + '"></div>' +
    '<div class="form-row">' +
      '<div class="form-group"><label>医院</label><input class="input" id="d_hosp" value="' + escapeHtml(d.hospital||'') + '"></div>' +
      '<div class="form-group"><label>科室</label><input class="input" id="d_dept" value="' + escapeHtml(d.dept||'') + '"></div>' +
    '</div>' +
    '<div class="form-group"><label>电话</label><input class="input" id="d_phone" type="tel" value="' + escapeHtml(d.phone||'') + '"></div>' +
    '<div class="form-group"><label>下次复诊日期</label><input class="input" id="d_visit" type="date" value="' + (d.nextVisit||'') + '"></div>' +
    '<button class="btn btn-primary" id="btnSaveDoc">保存</button>';
}
function openDoctorForm(d){
  openModal(doctorFormHTML(d));
  $('#btnSaveDoc').addEventListener('click', function(){
    var name = $('#d_name').value.trim();
    if(!name){ toast('请填写医生姓名'); return; }
    var data = {
      name: name, hospital: $('#d_hosp').value.trim(), dept: $('#d_dept').value.trim(),
      phone: $('#d_phone').value.trim(), nextVisit: $('#d_visit').value
    };
    if(d && d.id){ Object.assign(getDoctor(d.id), data); }
    else { data.id = uid(); DB.doctors.push(data); }
    saveDB(); closeModal(); renderMine(); render(); toast('已保存');
  });
}
function getDoctor(id){ return DB.doctors.find(function(x){ return x.id === id; }); }

/* ================================================================
 * 备份 / 导出
 * ================================================================ */
function downloadText(filename, text, mime){
  try{
    var blob = new Blob([text], { type: mime || 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); }, 500);
    return true;
  }catch(e){ return false; }
}
function exportJSON(){
  var data = { app:'药管家', version:2, exportedAt: new Date().toISOString(), db: DB };
  var json = JSON.stringify(data, null, 2);
  if(bridge()){
    copyText(json);
    toast('备份文本已复制，请粘贴到备忘录/文件保存');
    return;
  }
  var ok = downloadText('药管家备份-' + todayStr() + '.json', json);
  if(!ok) copyText(json);
  toast(ok ? '已导出备份文件' : '已复制备份文本，请粘贴保存');
}
function importJSON(file){
  var reader = new FileReader();
  reader.onload = function(){
    try{
      var data = JSON.parse(reader.result);
      var db = data.db || data;
      if(!db.meds) throw new Error('格式不对');
      DB.meds = db.meds || []; DB.logs = db.logs || [];
      DB.members = db.members && db.members.length ? db.members : [{id:'me',name:'我自己',relation:'本人',color:'#3b82f6'}];
      DB.doctors = db.doctors || [];
      DB.settings = Object.assign(DB.settings, db.settings || {});
      saveDB(); loadDB(); render();
      toast('导入成功：' + DB.meds.length + ' 种药品，' + DB.logs.length + ' 条记录');
    }catch(e){
      toast('导入失败：文件格式不正确');
    }
  };
  reader.readAsText(file);
}
function exportCSV(){
  var rows = [['日期','时间','药品','剂量','单位']];
  DB.logs.slice().sort(function(a,b){ return a.date.localeCompare(b.date) || a.time.localeCompare(b.time); })
    .forEach(function(l){
      var med = getMed(l.medId);
      rows.push([l.date, l.time, med ? med.name : '已删除', l.dose, med ? med.unit : '']);
    });
  var csv = rows.map(function(r){ return r.map(function(c){
    return '"' + String(c).replace(/"/g,'""') + '"';
  }).join(','); }).join('\n');
  if(bridge()){
    copyText(csv);
    toast('CSV 已复制，请粘贴到备忘录/文件保存');
    return;
  }
  var ok = downloadText('打卡记录-' + todayStr() + '.csv', '\ufeff' + csv, 'text/csv');
  toast(ok ? '已导出 CSV' : '导出失败，请重试');
}

/* ---------------- 用药报告 ---------------- */
function buildReport(){
  var since = new Date(); since.setDate(since.getDate() - 29);
  var sinceStr = since.getFullYear() + '-' + pad2(since.getMonth()+1) + '-' + pad2(since.getDate());
  var logs = DB.logs.filter(function(l){ return l.date >= sinceStr; });
  var lines = [];
  lines.push('【药管家】近30天用药报告');
  lines.push('生成时间：' + todayStr() + ' ' + nowHM());
  lines.push('------------------------------');
  if(DB.meds.length === 0){ lines.push('暂无药品记录'); }
  DB.meds.forEach(function(med){
    var ml = logs.filter(function(l){ return l.medId === med.id; });
    var totalDose = ml.reduce(function(s,l){ return s + l.dose; }, 0);
    lines.push('▎' + med.name + (med.spec ? '（' + med.spec + '）' : ''));
    lines.push('  打卡 ' + ml.length + ' 次 · 共 ' + totalDose + med.unit +
      ' · 剩余 ' + (med.stock||0) + med.unit +
      (stockDays(med)!=null ? ' · 约够 ' + stockDays(med) + ' 天' : ''));
    if(med.expiryDate) lines.push('  有效期至 ' + fmtDate(med.expiryDate));
  });
  lines.push('------------------------------');
  var s30 = statRange(30);
  lines.push('近30天依从率：' + s30.pct + '%（' + s30.done + '/' + s30.need + ' 次）');
  lines.push('连续打卡：' + streakDays() + ' 天');
  if(DB.doctors.length){
    lines.push('------------------------------');
    DB.doctors.forEach(function(d){
      lines.push('医生：' + d.name + (d.hospital ? '（' + d.hospital + '）' : '') + (d.nextVisit ? ' · 复诊 ' + fmtDate(d.nextVisit) : ''));
    });
  }
  lines.push('———————————————');
  lines.push('本报告仅供参考，请遵医嘱用药。');
  return lines.join('\n');
}
function openReport(share){
  var text = buildReport();
  openModal('<h3>近 30 天用药报告<button class="close-x" data-close>✕</button></h3>' +
    '<div class="report-pre">' + escapeHtml(text) + '</div>' +
    '<div class="btn-row" style="margin-top:10px">' +
    '<button class="btn btn-ghost" id="btnCopyReport">复制文本</button>' +
    (share ? '<button class="btn btn-primary" id="btnShareReport">分享</button>' : '') +
    '</div>');
  $('#btnCopyReport').addEventListener('click', function(){ copyText(text); toast('已复制'); });
  if(share){
    $('#btnShareReport').addEventListener('click', function(){
      nativeShare(text, '药管家 · 用药报告');
      closeModal();
    });
  }
}
function copyText(text){
  var done = false;
  try{
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text); done = true;
    }
  }catch(e){}
  if(!done){
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position='fixed'; ta.style.opacity='0';
    document.body.appendChild(ta); ta.select();
    try{ document.execCommand('copy'); done = true; }catch(e){}
    ta.remove();
  }
  return done;
}

/* ---------------- 原生桥 ---------------- */
function bridge(){ return window.Android || window.MedKeeper || null; }
function nativeToast(msg){
  var b = bridge();
  if(b && b.toast) try{ b.toast(msg); }catch(e){}
}
function nativeShare(text, title){
  var b = bridge();
  if(b && b.shareText) try{ b.shareText(text, title || '药管家'); return true; }catch(e){}
  return false;
}

/* ================================================================
 * Toast / 导航
 * ================================================================ */
var toastTimer = null;
function toast(msg){
  var el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ el.hidden = true; }, 2200);
}
function switchPage(page){
  state.page = page;
  ['today','meds','cal','stat','mine'].forEach(function(p){
    $('#page-' + p).hidden = (p !== page);
  });
  document.querySelectorAll('.tab').forEach(function(t){
    t.classList.toggle('on', t.dataset.page === page);
  });
  if(page === 'today') renderToday();
  if(page === 'meds') renderMeds();
  if(page === 'cal') renderCal();
  if(page === 'stat') renderStat();
  if(page === 'mine') renderMine();
}
function render(){
  $('#todayLine').textContent = todayStr() + ' ' + weekdayCN(new Date());
  renderToday();
  if(state.page === 'meds') renderMeds();
  if(state.page === 'cal') renderCal();
  if(state.page === 'stat') renderStat();
  if(state.page === 'mine') renderMine();
}

/* ================================================================
 * 事件绑定
 * ================================================================ */
function bindEvents(){
  $('#tabbar').addEventListener('click', function(e){
    var t = e.target.closest('.tab');
    if(t) switchPage(t.dataset.page);
  });
  $('#btnSettings').addEventListener('click', function(){ switchPage('mine'); });

  $('#todayTasks').addEventListener('click', function(e){
    var b = e.target.closest('.t-check');
    if(!b) return;
    var med = getMed(b.dataset.med);
    if(!med) return;
    if(b.querySelector('.ico')){ /* 已打卡状态由 class done 决定 */ }
    if(b.closest('.task').classList.contains('done')){ toast('今日该时段已打卡'); return; }
    checkin(med, b.dataset.time || nowHM());
  });
  $('#todayLogs').addEventListener('click', function(e){
    var b = e.target.closest('[data-undo]');
    if(b) undoLog(b.dataset.undo);
  });
  $('#btnQuickLog').addEventListener('click', openQuickLog);

  $('#medSearch').addEventListener('input', function(){ state.search = this.value; renderMeds(); });
  $('#catChips').addEventListener('click', function(e){
    var c = e.target.closest('.chip');
    if(c){ state.cat = c.dataset.cat; renderMeds(); }
  });
  $('#medList').addEventListener('click', function(e){
    var item = e.target.closest('.med-item');
    if(item){
      var med = getMed(item.dataset.med);
      if(med) openMedDetail(med);
    }
  });
  $('#btnAddMed').addEventListener('click', function(){ openMedForm(null); });

  $('#calPrev').addEventListener('click', function(){
    state.calMonth--; if(state.calMonth < 0){ state.calMonth = 11; state.calYear--; }
    renderCal();
  });
  $('#calNext').addEventListener('click', function(){
    state.calMonth++; if(state.calMonth > 11){ state.calMonth = 0; state.calYear++; }
    renderCal();
  });
  $('#calGrid').addEventListener('click', function(e){
    var d = e.target.closest('.cal-day');
    if(d && d.dataset.day){ state.calDay = d.dataset.day; renderCal(); }
  });
  $('#calDayLogs').addEventListener('click', function(e){
    var b = e.target.closest('[data-undo]');
    if(b) undoLog(b.dataset.undo);
  });

  $('#btnAddMember').addEventListener('click', openMemberForm);
  $('#memberList').addEventListener('click', function(e){
    var b = e.target.closest('[data-memdel]');
    if(!b) return;
    if(!confirm('删除该成员？其药品将归属"我自己"。')) return;
    DB.members = DB.members.filter(function(m){ return m.id !== b.dataset.memdel; });
    DB.meds.forEach(function(m){ if(m.memberId === b.dataset.memdel) m.memberId = 'me'; });
    saveDB(); renderMine(); render(); toast('已删除成员');
  });
  $('#btnAddDoctor').addEventListener('click', function(){ openDoctorForm(null); });
  $('#doctorList').addEventListener('click', function(e){
    var del = e.target.closest('[data-docdel]');
    var edit = e.target.closest('[data-docedit]');
    if(del){
      if(!confirm('删除该医生信息？')) return;
      DB.doctors = DB.doctors.filter(function(d){ return d.id !== del.dataset.docdel; });
      saveDB(); renderMine(); render(); toast('已删除');
    } else if(edit){
      openDoctorForm(getDoctor(edit.dataset.docedit));
    }
  });

  $('#btnExport').addEventListener('click', exportJSON);
  $('#btnImport').addEventListener('click', function(){ $('#importFile').click(); });
  $('#importFile').addEventListener('change', function(){
    if(this.files && this.files[0]) importJSON(this.files[0]);
    this.value = '';
  });
  $('#btnExportCsv').addEventListener('click', exportCSV);
  $('#btnReport').addEventListener('click', function(){ openReport(false); });
  $('#btnReportShare').addEventListener('click', function(){ openReport(true); });

  $('#swDark').addEventListener('change', function(){ DB.settings.dark = this.checked ? 1 : 0; saveDB(); applyTheme(); });
  $('#swSound').addEventListener('change', function(){ DB.settings.sound = this.checked; saveDB(); });
  $('#swNotify').addEventListener('change', function(){
    DB.settings.notify = this.checked;
    saveDB();
    if(this.checked){
      if('Notification' in window && Notification.permission === 'default'){
        Notification.requestPermission().then(function(p){
          DB.settings.notify = (p === 'granted');
          saveDB(); renderMine();
          toast(p === 'granted' ? '通知已开启' : '通知权限未授予');
        });
      } else if('Notification' in window && Notification.permission === 'granted'){
        toast('通知已开启');
      } else {
        toast('浏览器未支持或已拒绝通知');
      }
    }
  });
  $('#btnTestRemind').addEventListener('click', function(){
    beep();
    notify('🔔 测试提醒', '提醒功能正常，当前时间 ' + nowHM());
    toast('已触发铃声' + (DB.settings.notify ? '与系统通知' : ''));
  });

  $('#btnTaken').addEventListener('click', takenFromReminder);
  $('#btnSnooze').addEventListener('click', snooze);

  $('#modalMask').addEventListener('click', function(e){
    if(e.target === this || e.target.closest('[data-close]')) closeModal();
  });
}

/* ---------------- 主题 ---------------- */
function applyTheme(){
  var dark = DB.settings.dark === 1 ||
    (DB.settings.dark !== 0 && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.dark = dark ? '1' : '0';
}

/* ================================================================
 * 初始化
 * ================================================================ */
function init(){
  loadDB();
  applyTheme();
  bindEvents();
  render();
  if(DB.settings.firstRun){
    DB.settings.firstRun = false;
    saveDB();
    if(DB.meds.length === 0){
      setTimeout(function(){
        openModal('<h3>👋 欢迎使用药管家</h3>' +
          '<div class="hint" style="margin:0 0 14px;line-height:1.8">药管家帮你管理全家用药：<br>' +
          '· 拍照识别药品，自动填入药名与效期<br>' +
          '· 定时提醒服药，到点弹窗+铃声<br>' +
          '· 记录库存与用量，推算还能吃多久<br>' +
          '· 日历打卡、依从率统计、备份导出<br>' +
          '所有数据仅保存在本机，不上传。</div>' +
          '<button class="btn btn-primary" id="btnStart">开始使用</button>');
        $('#btnStart').addEventListener('click', closeModal);
      }, 400);
    }
  }
  setInterval(checkReminders, 15000);
  checkReminders();
}
document.addEventListener('DOMContentLoaded', init);
