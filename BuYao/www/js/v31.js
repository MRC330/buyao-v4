/* ================================================================
 * 补药 3.1 · 新增功能模块
 * 1. 系统级定时通知   2. 14天双轴趋势图   3. 常见药品快捷库
 * 4. 复诊倒计时       5. 症状时间线       6. 温和波动提示
 * 7. 报告导出图片     8. 自定义提醒文案   9. 用药日记
 * 10. 会员权益管理页
 * 设计原则不变：只记录、不判断、数据留本地。
 * ================================================================ */

/* ============================================================
 * 1. 系统级定时通知（原生 AlarmManager 桥）
 * ============================================================ */
function nativeReminderReady(){
  return typeof Android !== 'undefined' && Android && typeof Android.scheduleReminders === 'function';
}
function syncNativeReminders(){
  if(!nativeReminderReady()) return;
  var seen = {}, plans = [];
  DB.meds.forEach(function(m){
    if(m.enabled === false) return;
    timesOf(m).forEach(function(t){
      if(seen[t]) return; seen[t] = 1;
      var title = DB.settings.mask
        ? (DB.settings.reminderText || '记得今天的份')
        : '该服用 ' + m.name;
      plans.push({ time: t, title: title });
    });
  });
  try{ Android.scheduleReminders(JSON.stringify(plans)); }catch(e){}
}
/* 包装 saveDB：每次保存后同步提醒计划到原生（关 App 也能提醒） */
var _saveDB = saveDB;
saveDB = function(){
  _saveDB();
  syncNativeReminders();
};

/* ============================================================
 * 2. 14 天情绪 + 依从率双轴趋势图
 * ============================================================ */
function svgDualLine(moods, adh){
  var w = 320, h = 120, pad = 10;
  function pts(vals, max){
    var step = vals.length > 1 ? (w - pad*2) / (vals.length - 1) : 0;
    return vals.map(function(v, i){
      var x = pad + i*step;
      var y = h - pad - (v/max) * (h - pad*2);
      return [x, Math.max(pad, Math.min(h - pad, y))];
    });
  }
  var pm = pts(moods, 5), pa = pts(adh, 100);
  function path(p){ return p.map(function(pt, i){ return (i?'L':'M') + pt[0].toFixed(1) + ' ' + pt[1].toFixed(1); }).join(' '); }
  return '<svg class="chart" viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none" style="height:'+h+'px">' +
    '<path d="'+path(pa)+'" fill="none" stroke="var(--blue)" stroke-width="2" stroke-dasharray="4 3" stroke-linejoin="round"/>' +
    '<path d="'+path(pm)+'" fill="none" stroke="var(--pink)" stroke-width="2" stroke-linejoin="round"/>' +
    pm.map(function(p,i){ return '<circle cx="'+p[0].toFixed(1)+'" cy="'+p[1].toFixed(1)+'" r="2.4" fill="var(--pink)"/>'; }).join('') +
    pa.map(function(p,i){ return '<circle cx="'+p[0].toFixed(1)+'" cy="'+p[1].toFixed(1)+'" r="2.4" fill="var(--blue)"/>'; }).join('') +
    '<text x="'+pad+'" y="13" font-size="9" fill="var(--pink)">心情(0-5)</text>' +
    '<text x="'+pad+'" y="25" font-size="9" fill="var(--blue)">依从率(%)</text></svg>';
}
function renderTrendChart(){
  var box = $('#trendChart');
  if(!box) return;
  var moods = [], adh = [];
  for(var i=13;i>=0;i--){
    var d = addDays(today(), -i);
    var m = getMood(d);
    moods.push(m ? m.score : 0);
    var should = 0;
    DB.meds.forEach(function(m2){
      if(m2.enabled === false) return;
      if(m2.startDate && dayDiff(m2.startDate, d) < 0) return;
      should += timesOf(m2).length;
    });
    var got = logsOf(d).length;
    adh.push(should ? Math.round(got/should*100) : 0);
  }
  var has = moods.some(function(v){ return v > 0; }) || adh.some(function(v){ return v > 0; });
  box.innerHTML = has
    ? svgDualLine(moods, adh)
    : '<div class="hint">记录几天之后，这里会出现心情与服药依从的对比线</div>';
}

/* ============================================================
 * 3. 常见药品快捷库（仅作快速录入参考，不含用药建议）
 * ============================================================ */
var COMMON_MEDS = [
  { name:'舍曲林',     dose:'1', unit:'片', note:'SSRI 类抗抑郁药' },
  { name:'氟西汀',     dose:'1', unit:'片', note:'SSRI 类抗抑郁药' },
  { name:'帕罗西汀',   dose:'1', unit:'片', note:'SSRI 类，骤停反应较明显' },
  { name:'艾司西酞普兰', dose:'1', unit:'片', note:'SSRI 类抗抑郁药' },
  { name:'西酞普兰',   dose:'1', unit:'片', note:'SSRI 类抗抑郁药' },
  { name:'文拉法辛',   dose:'1', unit:'片', note:'SNRI 类，半衰期短、骤停反应明显' },
  { name:'度洛西汀',   dose:'1', unit:'片', note:'SNRI 类' },
  { name:'米氮平',     dose:'1', unit:'片', note:'去甲肾上腺素能特异性抗抑郁' },
  { name:'阿戈美拉汀', dose:'1', unit:'片', note:'' },
  { name:'安非他酮',   dose:'1', unit:'片', note:'' },
  { name:'曲唑酮',     dose:'1', unit:'片', note:'常用于助眠' },
  { name:'劳拉西泮',   dose:'1', unit:'片', note:'苯二氮䓬类，按需使用' },
  { name:'阿普唑仑',   dose:'1', unit:'片', note:'苯二氮䓬类，按需使用' },
  { name:'坦度螺酮',   dose:'1', unit:'片', note:'抗焦虑' },
  { name:'丁螺环酮',   dose:'1', unit:'片', note:'抗焦虑' },
  { name:'喹硫平',     dose:'1', unit:'片', note:'小剂量常用于助眠/稳定情绪' },
  { name:'奥氮平',     dose:'1', unit:'片', note:'' },
  { name:'碳酸锂',     dose:'1', unit:'片', note:'心境稳定剂' }
];
function openCommonMedSheet(){
  openModal('常见药品（仅供参考）',
    '<div class="hint" style="margin-bottom:12px">以下为常见精神类药品清单，<b>仅作快速录入参考，不含任何用药建议</b>。' +
    '具体剂量与用法<b>务必以你的医生处方为准</b>。</div>' +
    '<div id="cmList">' + COMMON_MEDS.map(function(m, i){
      return '<div class="row" data-cm="'+i+'"><div class="row-ico">'+ico('pill','ico-sm')+'</div>' +
        '<div class="row-main"><div class="row-t">'+esc(m.name)+'</div>' +
        '<div class="row-d">'+esc(m.note || '点击按常用方式预填')+'</div></div>' +
        '<div class="row-go">'+ico('right')+'</div></div>';
    }).join('') + '</div>' +
    '<div class="hint" style="margin-top:12px">点击后会在「添加」表单里预填名称与提示，<b>剂量仍需你按处方确认</b>。</div>',
    function(){
      $$('#cmList [data-cm]').forEach(function(el){
        el.onclick = function(){
          var m = COMMON_MEDS[parseInt(el.getAttribute('data-cm'), 10)];
          closeModal();
          openMedSheet(null);
          setTimeout(function(){
            if($('#fName')) $('#fName').value = m.name;
            if($('#fDose')) $('#fDose').value = m.dose;
            if($('#fUnit')) $('#fUnit').value = m.unit;
            if($('#fNote')) $('#fNote').value = m.note;
            toast('已预填，请按处方确认剂量');
          }, 220);
        };
      });
    });
}

/* ============================================================
 * 4. 复诊倒计时（首页）
 * ============================================================ */
function renderVisitCountdown(){
  var box = $('#visitBox');
  if(!box) return;
  var up = null;
  DB.doctors.forEach(function(d){
    if(!d.nextVisit) return;
    var diff = daysTo(d.nextVisit);
    if(diff >= 0 && (up === null || diff < up.diff)) up = { doc:d, diff:diff };
  });
  if(!up){ box.innerHTML = ''; return; }
  box.innerHTML = '<div class="visit">' +
    '<div class="visit-l">'+ico('steth','ico-sm')+
    '<div><div class="visit-t">距复诊还有 <b>'+up.diff+'</b> 天</div>' +
    '<div class="visit-d">'+esc(up.doc.name)+(up.doc.dept?(' · '+esc(up.doc.dept)):'')+(up.diff<=3?' · 可以开始整理记录了':'')+'</div></div></div>' +
    (up.diff<=3 ? '<button class="btn btn-ghost btn-sm" onclick="switchPage(\'report\')">去生成报告</button>' : '') +
    '</div>';
}

/* ============================================================
 * 5. 症状时间线
 * ============================================================ */
function renderSymptomTimeline(){
  var box = $('#symptomTimeline');
  if(!box) return;
  var rows = DB.moods.filter(function(m){ return m.effects && m.effects.length; })
    .sort(function(a,b){ return a.date < b.date ? 1 : -1; })
    .slice(0, 14)
    .map(function(m){
      return '<div class="tl-row"><div class="tl-date">'+fmtCN(m.date)+'</div>' +
        '<div class="tl-tags">'+m.effects.map(function(e){ return '<span class="jtag">'+esc(e)+'</span>'; }).join('')+'</div></div>';
    });
  box.innerHTML = rows.length ? rows.join('') : '<div class="hint">还没有记录身体反应，记录几天后这里会出现变化轨迹</div>';
}

/* ============================================================
 * 6. 温和波动提示（非诊断，纯观察）
 * ============================================================ */
function renderFluctuation(){
  var box = $('#fluctBox');
  if(!box) return;
  function avg(arr){ return arr.length ? arr.reduce(function(s,m){ return s+m.score; },0)/arr.length : null; }
  var recent = DB.moods.filter(function(m){ var d=dayDiff(m.date,today()); return d<7 && d>=0; });
  var prev   = DB.moods.filter(function(m){ var d=dayDiff(m.date,today()); return d<14 && d>=7; });
  var ra = avg(recent), pa = avg(prev);
  if(ra != null && pa != null && (ra - pa) <= -0.8){
    box.innerHTML = '<div class="alert alert-pink">'+ico('leaf','ico-sm')+
      '<div>最近几天状态有些波动。这很常见，<b>不代表变糟了</b>——如果持续低落或难熬，' +
      '可以考虑约一次复诊，或拨打 <b>12356</b> 找人聊聊。</div></div>';
  } else {
    box.innerHTML = '';
  }
}

/* ============================================================
 * 7. 报告导出图片（会员）
 * ============================================================ */
function exportReportImage(){
  if(!can('report_export')){ needPro('report_export'); return; }
  var text = buildReport();
  var lines = text.split('\n');
  var W = 640, padX = 32, lh = 24, fs = 14;
  var H = padX*2 + lines.length*lh + 30;
  var c = document.createElement('canvas');
  c.width = W; c.height = H;
  var g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0,0,W,H);
  g.fillStyle = '#EC6496'; g.fillRect(0,0,W,8);
  var y = padX + fs;
  lines.forEach(function(ln){
    g.fillStyle = ln.indexOf('【') === 0 ? '#EC6496' : (ln.indexOf('──') === 0 ? '#dddddd' : '#333333');
    g.font = (ln.indexOf('【') === 0 ? '700 ' : '') + fs + 'px sans-serif';
    g.fillText(ln.slice(0, 44), padX, y);
    y += lh;
  });
  var url;
  try{ url = c.toDataURL('image/png'); }catch(e){ toast('当前环境不支持生成图片'); return; }
  var a = document.createElement('a');
  a.href = url; a.download = '补药复诊记录-' + today() + '.png';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function(){ toast('已生成图片，可分享给医生'); }, 200);
}

/* ============================================================
 * 8. 自定义提醒文案（会员）—— 输入框在 openRemindSheet 中
 * ============================================================ */
/* 在 core.js 的 showReminder 中已支持 DB.settings.reminderText，
   此处仅提供默认文案占位与保存逻辑封装 */

/* ============================================================
 * 9. 用药日记
 * ============================================================ */
var DIARY_KEY = 'xinqing_diary_v31';
function loadDiary(){ try{ return JSON.parse(localStorage.getItem(DIARY_KEY) || '[]'); }catch(e){ return []; } }
function saveDiary(arr){ try{ localStorage.setItem(DIARY_KEY, JSON.stringify(arr)); }catch(e){} }
function addDiaryEntry(text){
  text = (text||'').trim();
  if(!text){ toast('写点什么吧'); return; }
  var arr = loadDiary();
  arr.unshift({ date: today(), ts: Date.now(), text: text });
  arr = arr.slice(0, 50);
  saveDiary(arr);
  $('#diaryInput').value = '';
  renderDiary();
  toast('记下了');
}
function renderDiary(){
  var box = $('#diaryBox');
  if(!box) return;
  var arr = loadDiary();
  if(!arr.length){ box.innerHTML = '<div class="hint">还没有写日记，记下今天任何想说的都行</div>'; return; }
  box.innerHTML = arr.slice(0, 12).map(function(d){
    return '<div class="diary"><div class="diary-d">'+fmtCN(d.date)+'</div><div class="diary-t">'+esc(d.text)+'</div></div>';
  }).join('');
}

/* ============================================================
 * 10. 会员权益管理页
 * ============================================================ */
function renderLicenseManage(){
  var box = $('#licManage');
  if(!box) return;
  if(!License.isPro()){
    box.innerHTML = '<div class="hint">当前为<b>免费版</b>。基础的服药提醒与记录永久免费；' +
      '升级会员可解锁多渠道提醒、报告导出、完整历史等。<br>' +
      '<a href="javascript:;" onclick="openLicenseSheet()" style="color:var(--pink-deep)">输入兑换码升级</a></div>';
    return;
  }
  var s = License.state;
  box.innerHTML = '<div class="lic-card">' +
    '<div class="lic-top"><span class="badge badge-pink">'+esc(License.planName())+'</span>' +
    '<span class="hint">'+esc(License.expiryText())+'</span></div>' +
    '<div class="lic-row"><span>兑换码</span><b>'+esc(s.code || '—')+'</b></div>' +
    '<div class="lic-row"><span>激活设备</span><b>'+(s.device ? (s.device.slice(0,8)+'…') : '本机')+'</b></div>' +
    '<div class="lic-row"><span>激活时间</span><b>'+(s.at ? new Date(s.at).toLocaleDateString() : '—')+'</b></div>' +
    '</div>';
}

/* ============================================================
 * 挂载到现有渲染链
 * ============================================================ */
var _renderMoodPage = renderMoodPage;
renderMoodPage = function(){ _renderMoodPage(); renderSymptomTimeline(); renderDiary(); };

var _renderReport = renderReport;
renderReport = function(){ _renderReport(); renderTrendChart(); };

var _renderToday = renderToday;
renderToday = function(){ _renderToday(); renderVisitCountdown(); renderFluctuation(); };

var _renderMine = renderMine;
renderMine = function(){ _renderMine(); renderLicenseManage(); };

/* ============================================================
 * 初始化：绑定 3.1 新增交互
 * ============================================================ */
function initV31(){
  try{
    var b = $('#btnCommonMed'); if(b) b.onclick = openCommonMedSheet;
    var ri = $('#btnReportImg'); if(ri) ri.onclick = exportReportImage;
    var ds = $('#btnDiarySave'); if(ds) ds.onclick = function(){ addDiaryEntry($('#diaryInput').value); };
    // 初次同步原生提醒
    syncNativeReminders();
    // 重新渲染涉及新模块的首页/报告
    if(state.page === 'today')   renderToday();
    if(state.page === 'mood')    renderMoodPage();
    if(state.page === 'report')   renderReport();
  }catch(e){ console.warn('initV31', e); }
}
document.addEventListener('DOMContentLoaded', function(){ setTimeout(initV31, 0); });
