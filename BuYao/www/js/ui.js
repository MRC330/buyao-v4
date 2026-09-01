/* ================================================================
 * 补药 3.0 · 渲染层
 * ================================================================ */
'use strict';

var state = {
  page: 'today',
  cat: '全部',
  search: '',
  calY: new Date().getFullYear(),
  calM: new Date().getMonth(),
  calDay: today(),
  draftMed: null,
  draftMood: { score: 0, effects: [] }
};

/* ---------------- 主题 ---------------- */
function applyTheme(){
  document.documentElement.setAttribute('data-theme', DB.settings.theme || 'light');
  var meta = document.querySelector('meta[name=theme-color]');
  if(meta) meta.setAttribute('content', DB.settings.theme === 'dark' ? '#000000' : '#F5F5F7');
}

/* ---------------- 问候 ---------------- */
function renderGreet(){
  var h = new Date().getHours();
  var g = h < 6 ? '还醒着呀' : h < 11 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : h < 23 ? '晚上好' : '夜深了';
  var tips = [
    '今天也要好好的',
    '慢慢来，比较快',
    '记得照顾自己',
    '你已经做得很好了',
    '今天也辛苦了',
    '不着急，一件事一件事来'
  ];
  var tip = tips[new Date().getDate() % tips.length];
  $('#greet').innerHTML = esc(g) + '<b>' + esc(tip) + '</b>';
}

/* ================================================================
 * 今天
 * ================================================================ */
function renderToday(){
  var meds = DB.meds.filter(function(m){ return m.enabled !== false; });
  var total = 0, done = 0;
  meds.forEach(function(m){
    timesOf(m).forEach(function(t){ total++; if(isDone(m.id, t)) done++; });
  });
  var pct = total ? Math.round(done/total*100) : 0;

  $('#heroNum').innerHTML = done + '<small>/' + total + '</small>';
  $('#heroRing').innerHTML = svgRing(pct);
  $('#heroBar').style.width = pct + '%';
  $('#heroLabel').textContent = total === 0 ? '还没有安排，去添加吧'
    : done === total ? '今天都完成了，很棒' : ('还差 ' + (total-done) + ' 件');
  $('#heroTip').textContent = total
    ? (pct === 100 ? '完整的一天，值得被记住' : '完成一件就算一件，别给自己压力')
    : '添加后，这里会显示今天的进度';

  renderJourney();
  renderAlerts();
  renderTodayTasks();
  renderMoodQuick();
}

/* 起效期陪伴卡 */
function renderJourney(){
  var box = $('#journeyBox');
  var d = treatDay();
  if(!DB.settings.startDate || d <= 0){ box.innerHTML = ''; return; }

  var txt, tags = [];
  if(d <= 14){
    txt = '刚开始的阶段，身体可能会先出现一些反应（比如恶心、嗜睡、头晕），而情绪的改善通常要再等一等。<b>这不是没效果</b>，是药物需要时间建立稳定的浓度。';
    tags = ['身体反应多属正常', '2–4 周后逐渐起效', '别急着下结论'];
  }else if(d <= 28){
    txt = '已经坚持 ' + d + ' 天了。这个阶段很多人开始感觉到细微的变化——可能是睡眠好一点，可能是没那么累了。<b>变化往往是悄悄发生的</b>，记录下来才看得见。';
    tags = ['变化可能很细微', '记录帮你看见趋势', '坚持就是进展'];
  }else if(d <= 90){
    txt = '第 ' + d + ' 天，已经走过最难的开头。接下来最重要的是<b>保持稳定</b>——即使感觉好了，也请按医生安排的疗程继续。';
    tags = ['感觉好 ≠ 可以停', '足疗程更关键', '复诊时带上记录'];
  }else{
    txt = '已经坚持 ' + d + ' 天了。长期维持治疗能显著降低复发风险。关于减量或停药，<b>请一定和医生一起决定</b>。';
    tags = ['维持治疗降低复发', '减量需医生指导', '不可骤停'];
  }

  box.innerHTML =
    '<div class="journey">' +
      '<div class="journey-top">'+ico('leaf','ico-sm')+
        '<span class="journey-day">第 '+d+' 天<small>／治疗进行中</small></span></div>' +
      '<div class="journey-txt">'+txt+'</div>' +
      '<div class="journey-tags">'+tags.map(function(t){ return '<span class="jtag">'+esc(t)+'</span>'; }).join('')+'</div>' +
    '</div>';
}

/* 预警区 */
function renderAlerts(){
  var out = [];
  var todayStr_ = today();

  DB.meds.forEach(function(m){
    if(m.enabled === false) return;
    // 库存
    var sd = stockDays(m);
    var lowAt = m.lowAt != null ? m.lowAt : 7;
    if(sd !== null && sd <= lowAt){
      out.push({ type: sd <= 0 ? 'danger' : 'warn', icon:'box',
        html:'<b>'+esc(m.name)+'</b> ' + (sd <= 0 ? '库存已用尽' : ('只剩约 '+sd+' 天')) + '，记得提前配药' });
    }
    // 效期
    if(m.expiry){
      var d = daysTo(m.expiry);
      if(d < 0)       out.push({ type:'danger', icon:'alert', html:'<b>'+esc(m.name)+'</b> 已过期，请停止使用并咨询药师' });
      else if(d <= 30) out.push({ type:'warn', icon:'clock', html:'<b>'+esc(m.name)+'</b> 距有效期还有 '+d+' 天' });
    }
    // 减量/停药标记
    if((m.risk||[]).indexOf('需缓慢减量') >= 0){
      out.push({ type:'info', icon:'leaf',
        html:'<b>'+esc(m.name)+'</b> 标记了「需缓慢减量」——任何减量或停药都要先问医生' });
    }
  });

  // 复诊提醒
  DB.doctors.forEach(function(doc){
    if(!doc.nextVisit) return;
    var d = daysTo(doc.nextVisit);
    if(d < 0)       out.push({ type:'warn', icon:'steth', html:'与 <b>'+esc(doc.name)+'</b> 的复诊日期已过，记得重新预约' });
    else if(d <= 7) out.push({ type:'info', icon:'steth', html:'还有 '+d+' 天复诊（'+esc(doc.name)+'），可以先整理好记录' });
  });

  // 漏服提醒
  var missed = [];
  DB.meds.forEach(function(m){
    if(m.enabled === false) return;
    timesOf(m).forEach(function(t){
      if(!isDone(m.id, t) && nowMin() - toMin(t) > 60 && nowMin() - toMin(t) < 600){
        missed.push(m.name);
      }
    });
  });
  if(missed.length){
    out.push({ type:'pink', icon:'clock',
      html:'有 '+missed.length+' 档还没记：'+esc(missed.slice(0,3).join('、'))+(missed.length>3?' 等':'')+'。忘了也没关系，想起来就补上' });
  }

  $('#alertBox').innerHTML = out.map(function(a){
    return '<div class="alert alert-'+a.type+'">'+ico(a.icon,'ico-sm')+'<div>'+a.html+'</div></div>';
  }).join('');
}

/* 今日任务 */
function renderTodayTasks(){
  var box = $('#todayTasks');
  var meds = DB.meds.filter(function(m){ return m.enabled !== false; });
  if(meds.length === 0){
    box.innerHTML =
      '<div class="empty">'+ico('pill')+
      '<div class="empty-t">还没有添加任何安排</div>'+
      '<div class="empty-d">添加后会按时间提醒你<br>也可以拍照识别包装上的文字</div>'+
      '<button class="btn btn-primary btn-sm" style="margin-top:14px" onclick="switchPage(\'meds\')">去添加</button></div>';
    return;
  }

  var items = [];
  meds.forEach(function(m){
    timesOf(m).forEach(function(t){ items.push({ med:m, time:t, done:isDone(m.id, t) }); });
  });
  items.sort(function(a,b){ return a.time < b.time ? -1 : (a.time > b.time ? 1 : 0); });

  box.innerHTML = items.map(function(it){
    var late = !it.done && nowMin() - toMin(it.time) > 60;
    return '<div class="task'+(it.done?' done':'')+'" data-med="'+it.med.id+'" data-time="'+it.time+'">' +
      '<button class="task-check" data-act="toggle">'+ico('check','ico-sm')+'</button>' +
      '<div class="task-main">' +
        '<div class="task-name">'+esc(DB.settings.mask && false ? '今天的份' : it.med.name)+'</div>' +
        '<div class="task-sub">'+esc((it.med.dose||'') + (it.med.unit||''))+(it.med.risk && it.med.risk.length ? ' · '+esc(it.med.risk[0]) : '')+'</div>' +
      '</div>' +
      '<div class="task-time'+(late?' late':'')+'">'+it.time+'</div>' +
    '</div>';
  }).join('') +
  '<div class="hint" style="text-align:center;margin-top:12px">点左边的圈圈可以打勾，再点一次可撤销</div>';

  $$('#todayTasks .task').forEach(function(el){
    el.querySelector('[data-act=toggle]').onclick = function(){
      toggleLog(el.getAttribute('data-med'), el.getAttribute('data-time'));
    };
  });
}

/* 首页心情速记 */
function renderMoodQuick(){
  var box = $('#moodQuick');
  var m = getMood(today());
  if(m){
    var mo = MOODS[m.v-1] || MOODS[2];
    box.innerHTML =
      '<div class="card-h" style="margin-bottom:8px"><h3>'+ico('heart')+'今天记过了</h3>'+
      '<span class="act" onclick="switchPage(\'mood\')">去修改</span></div>' +
      '<div style="display:flex;align-items:center;gap:12px">' +
        '<div style="font-size:34px;line-height:1">'+mo.face+'</div>' +
        '<div><div style="font-size:15px;font-weight:600">'+esc(mo.label)+'</div>' +
        '<div class="hint">'+(m.effects && m.effects.length ? esc(m.effects.join('、')) : '没有记录身体反应')+'</div></div>' +
      '</div>';
  }else{
    box.innerHTML =
      '<div class="card-h" style="margin-bottom:10px"><h3>'+ico('heart')+'现在感觉怎么样</h3></div>' +
      '<div class="mood-row">' + MOODS.map(function(mo){
        return '<button class="mood-item" data-v="'+mo.v+'"><span class="face">'+mo.face+'</span>'+esc(mo.label)+'</button>';
      }).join('') + '</div>' +
      '<div class="hint">只会存在你的手机里，不会上传</div>';
    $$('#moodQuick .mood-item').forEach(function(b){
      b.onclick = function(){ quickMood(parseInt(b.getAttribute('data-v'),10)); };
    });
  }
}

/* ================================================================
 * 记录页
 * ================================================================ */
function renderMoodPage(){
  $('#moodDate').textContent = fmtCN(today()) + ' ' + weekCN(new Date());

  var m = getMood(today());
  state.draftMood = { score: m ? m.score : 0, effects: m ? (m.effects||[]).slice() : [] };

  $('#moodRow').innerHTML = MOODS.map(function(mo){
    return '<button class="mood-item'+(state.draftMood.score===mo.v?' on':'')+'" data-v="'+mo.v+'">' +
      '<span class="face">'+mo.face+'</span>'+esc(mo.label)+'</button>';
  }).join('');
  $$('#moodRow .mood-item').forEach(function(b){
    b.onclick = function(){
      state.draftMood.score = parseInt(b.getAttribute('data-v'),10);
      $$('#moodRow .mood-item').forEach(function(x){ x.classList.remove('on'); });
      b.classList.add('on');
    };
  });

  $('#effChips').innerHTML = EFFECTS.map(function(e){
    return '<button class="chip-eff'+(state.draftMood.effects.indexOf(e)>=0?' on':'')+'" data-e="'+esc(e)+'">'+esc(e)+'</button>';
  }).join('');
  $$('#effChips .chip-eff').forEach(function(b){
    b.onclick = function(){
      var e = b.getAttribute('data-e');
      var i = state.draftMood.effects.indexOf(e);
      if(i >= 0) state.draftMood.effects.splice(i,1); else state.draftMood.effects.push(e);
      b.classList.toggle('on');
      updateEffOther();
    };
  });

  $('#moodNote').value = m ? (m.note || '') : '';
  renderMoodChart();
  renderCalendar();
}

function updateEffOther(){ /* 预留：选择「其他」时可补充填写 */ }

function renderMoodChart(){
  var limit = can('full_history') ? 30 : 7;
  var vals = [], labels = [];
  for(var i = limit-1; i >= 0; i--){
    var d = addDays(today(), -i);
    var m = getMood(d);
    vals.push(m ? m.score : 0);
    labels.push(m ? m.score : 0);
  }
  var has = vals.some(function(v){ return v > 0; });
  $('#moodChart').innerHTML = has
    ? svgLine(vals, { min:0, max:5, h:92, color:'var(--pink)' }) +
      '<div class="hint" style="margin-top:6px">'+(can('full_history') ? '近 30 天' : '近 7 天（会员解锁 30 天）')+'</div>'
    : '<div class="hint">记录几天之后，这里会出现一条趋势线</div>';
}

/* ---------------- 日历 ---------------- */
function renderCalendar(){
  var y = state.calY, mo = state.calM;
  $('#calTitle').textContent = y + '年' + (mo+1) + '月';
  var first = new Date(y, mo, 1);
  var start = first.getDay();
  var days = new Date(y, mo+1, 0).getDate();
  var prevDays = new Date(y, mo, 0).getDate();

  var html = ['日','一','二','三','四','五','六'].map(function(w){ return '<div class="cal-w">'+w+'</div>'; }).join('');

  for(var i=0;i<start;i++){
    html += '<div class="cal-d out">'+(prevDays-start+i+1)+'</div>';
  }
  for(var d=1; d<=days; d++){
    var ds = y + '-' + pad2(mo+1) + '-' + pad2(d);
    var should = DB.meds.reduce(function(s,m){
      if(m.enabled === false) return s;
      if(m.startDate && dayDiff(m.startDate, ds) < 0) return s;
      return s + timesOf(m).length;
    }, 0);
    var got = logsOf(ds).length;
    var cls = 'cal-d';
    if(ds === today()) cls += ' today';
    if(got > 0) cls += ' has';
    if(should > 0 && got >= should) cls += ' full';
    if(ds === state.calDay) cls += ' sel';
    html += '<div class="'+cls+'" data-d="'+ds+'">'+d+(got>0?'<i></i>':'')+'</div>';
  }
  $('#calGrid').innerHTML = html;

  $$('#calGrid .cal-d[data-d]').forEach(function(el){
    el.onclick = function(){ state.calDay = el.getAttribute('data-d'); renderCalendar(); };
  });

  var dl = logsOf(state.calDay);
  var md = getMood(state.calDay);
  $('#calDayTitle').textContent = fmtCN(state.calDay) + ' · ' + weekCN(new Date(state.calDay.replace(/-/g,'/'))) + '（' + dl.length + ' 次记录）';
  var out = '';
  if(dl.length){
    out += dl.map(function(l){
      var m = getMed(l.medId);
      return '<div class="row"><div class="row-ico">'+ico('check','ico-sm')+'</div>' +
        '<div class="row-main"><div class="row-t">'+esc(m ? m.name : '已删除')+'</div>' +
        '<div class="row-d">'+l.time+' · '+esc(memberName(l.memberId))+'</div></div></div>';
    }).join('');
  }
  if(md){
    var mo2 = MOODS[md.score-1] || MOODS[2];
    out += '<div class="row"><div class="row-ico">'+ico('heart','ico-sm')+'</div>' +
      '<div class="row-main"><div class="row-t">心情：'+esc(mo2.label)+' '+mo2.face+'</div>' +
      '<div class="row-d">'+(md.effects && md.effects.length ? esc(md.effects.join('、')) : '无身体反应记录')+'</div></div></div>';
  }
  if(!out) out = '<div class="hint">这一天还没有记录</div>';
  $('#calDayLogs').innerHTML = out;
}

/* ================================================================
 * 药品页
 * ================================================================ */
function renderMeds(){
  $('#catChips').innerHTML = CATS.map(function(c){
    return '<button class="chip'+(state.cat===c?' on':'')+'" data-c="'+esc(c)+'">'+esc(c)+'</button>';
  }).join('');
  $$('#catChips .chip').forEach(function(b){
    b.onclick = function(){ state.cat = b.getAttribute('data-c'); renderMeds(); };
  });

  var list = DB.meds.filter(function(m){
    if(state.cat !== '全部' && m.cat !== state.cat) return false;
    if(state.search){
      var s = state.search.toLowerCase();
      return (m.name||'').toLowerCase().indexOf(s) >= 0 || (m.note||'').toLowerCase().indexOf(s) >= 0;
    }
    return true;
  });

  if(list.length === 0){
    $('#medList').innerHTML =
      '<div class="empty">'+ico('pill')+
      '<div class="empty-t">'+(DB.meds.length ? '没有符合条件的' : '还没有添加')+'</div>'+
      '<div class="empty-d">点右下角的按钮添加<br>可以用拍照识别包装上的文字</div></div>';
    return;
  }

  $('#medList').innerHTML = list.map(function(m){
    var sd = stockDays(m);
    var lowAt = m.lowAt != null ? m.lowAt : 7;
    var low = sd !== null && sd <= lowAt;
    var photo = m.photo ? '<img class="med-photo" src="'+m.photo+'">' : '';
    return '<div class="med" data-id="'+m.id+'">' +
      (photo || '<div class="med-ico">'+ico('pill')+'</div>') +
      '<div class="med-main">' +
        '<div class="med-name">'+esc(m.name)+(m.enabled===false?' <span class="tag">已停用</span>':'')+'</div>' +
        '<div class="med-meta">'+esc((m.dose||'')+(m.unit||'')+' × '+timesOf(m).length+'次/天')+
          (m.expiry ? ' · 至 '+esc(m.expiry) : '')+'</div>' +
      '</div>' +
      '<div class="med-right">' +
        '<div class="med-stock'+(low?' low':'')+'">'+(m.stock||0)+'</div>' +
        '<div class="med-days">'+(sd !== null ? ('约 '+sd+' 天') : '未填用量')+'</div>' +
      '</div>' +
    '</div>';
  }).join('');

  $$('#medList .med').forEach(function(el){
    el.onclick = function(){ openMedSheet(el.getAttribute('data-id')); };
  });

  if(!License.isPro() && DB.meds.length >= FREE_MED_LIMIT){
    $('#medList').insertAdjacentHTML('afterend',
      '<div class="hint" style="text-align:center;margin-top:10px">免费版最多 '+FREE_MED_LIMIT+' 种 · '+
      '<a href="javascript:;" onclick="openLicenseSheet()" style="color:var(--pink-deep)">输入兑换码解锁不限数量</a></div>');
  }
}

/* ================================================================
 * 报告页
 * ================================================================ */
function renderReport(){
  var a = adherence(30);
  var st = streak();
  var total = DB.logs.length;
  var recent = DB.moods.filter(function(m){ return dayDiff(m.date, today()) < 30 && dayDiff(m.date, today()) >= 0; });
  var avg = recent.length ? (recent.reduce(function(s,m){ return s + m.score; },0)/recent.length).toFixed(1) : '—';

  $('#statCards').innerHTML =
    '<div class="stat"><div class="stat-n">'+a.rate+'<small>%</small></div><div class="stat-t">30 天依从率</div></div>' +
    '<div class="stat"><div class="stat-n">'+st+'<small>天</small></div><div class="stat-t">连续打卡</div></div>' +
    '<div class="stat"><div class="stat-n">'+total+'<small>次</small></div><div class="stat-t">累计记录</div></div>' +
    '<div class="stat"><div class="stat-n">'+avg+'</div><div class="stat-t">心情均值（近 30 天）</div></div>';

  var vals = [];
  for(var i=13;i>=0;i--){
    var d = addDays(today(), -i);
    vals.push(logsOf(d).length);
  }
  $('#adhereChart').innerHTML = svgBars(vals.map(function(v,k){
    return { v:v, k: k%3===0 ? (14-k)+'天' : '', c:'var(--pink)' };
  }), { h:110 });
}

/* ================================================================
 * 我的
 * ================================================================ */
function renderMine(){
  var ch = DB.settings.channels || {};
  var on = [];
  if(ch.app) on.push('应用内');
  if(ch.wechat) on.push('微信');
  if(ch.sms) on.push('短信');
  if(ch.email) on.push('邮箱');
  $('#channelBrief').innerHTML =
    '<div class="row"><div class="row-ico">'+ico('bell','ico-sm')+'</div>' +
    '<div class="row-main"><div class="row-t">'+(on.length ? esc(on.join(' · ')) : '仅应用内提醒')+'</div>' +
    '<div class="row-d">'+(ch.wechat||ch.sms||ch.email ? '多渠道提醒已开启' : '开启多渠道提醒需要会员')+'</div></div></div>';

  $('#memberList').innerHTML = DB.members.length
    ? DB.members.map(function(m){
        return '<div class="row"><div class="row-ico">'+ico('users','ico-sm')+'</div>' +
          '<div class="row-main"><div class="row-t">'+esc(m.name)+'</div>' +
          '<div class="row-d">'+esc(m.relation||'')+'</div></div>' +
          (m.id !== 'me' ? '<button class="btn btn-ghost btn-sm" data-del-member="'+m.id+'">删除</button>' : '') +
        '</div>';
      }).join('')
    : '<div class="hint">还没有添加同伴</div>';
  $$('#memberList [data-del-member]').forEach(function(b){
    b.onclick = function(){ delMember(b.getAttribute('data-del-member')); };
  });

  $('#doctorList').innerHTML = DB.doctors.length
    ? DB.doctors.map(function(d){
        var t = d.nextVisit ? ('复诊：'+fmtCN(d.nextVisit) + (daysTo(d.nextVisit) >= 0 ? '（还有 '+daysTo(d.nextVisit)+' 天）' : '（已过期）')) : '未设置复诊';
        return '<div class="row" data-edit-doctor="'+d.id+'"><div class="row-ico">'+ico('steth','ico-sm')+'</div>' +
          '<div class="row-main"><div class="row-t">'+esc(d.name)+(d.dept?(' · '+esc(d.dept)):'')+'</div>' +
          '<div class="row-d">'+esc(d.hospital||'')+' · '+esc(t)+'</div></div>' +
          '<div class="row-go">'+ico('right')+'</div></div>';
      }).join('')
    : '<div class="hint">添加医生后，会在复诊前几天提醒你整理记录</div>';
  $$('#doctorList [data-edit-doctor]').forEach(function(el){
    el.onclick = function(){ openDoctorSheet(el.getAttribute('data-edit-doctor')); };
  });

  $('#knowBox').innerHTML = KNOWLEDGE.map(function(k){
    return '<div class="acc" data-k="'+k.id+'">' +
      '<button class="acc-h">'+ico(k.icon,'ico-sm')+'<span>'+esc(k.title)+'</span>' +
      '<svg class="ico arrow"><use href="#i-down"/></svg></button>' +
      '<div class="acc-b" hidden>'+k.body+'</div></div>';
  }).join('');
  $$('#knowBox .acc').forEach(function(el){
    el.querySelector('.acc-h').onclick = function(){
      var b = el.querySelector('.acc-b');
      var open = el.classList.toggle('open');
      b.hidden = !open;
    };
  });

  $('#channelBrief').onclick = function(){ openRemindSheet(); };

  var lic = License.isPro()
    ? '<b>'+esc(License.planName())+'</b> · '+esc(License.expiryText())
    : '<b>免费版</b>　<a href="javascript:;" onclick="openLicenseSheet()" style="color:var(--pink-deep)">输入兑换码解锁会员</a>';

  $('#aboutText').innerHTML =
    '补药 v3.1 · 每日陪伴<br>' +
    '当前版本：'+lic+'<br><br>' +
    '本应用是一个<b>记录工具</b>：只帮你记录，不做任何评估、诊断或用药建议，也不能替代医生的判断。<br><br>' +
    '所有服药与心情数据仅保存在本机，不上传服务器。<br>' +
    '如需帮助：全国心理援助热线 <b>12356</b>（24 小时 · 免费）';
}

/* ================================================================
 * 汇总
 * ================================================================ */
function renderAll(){
  applyTheme();
  renderGreet();
  renderToday();
  renderMoodPage();
  renderMeds();
  renderReport();
  renderMine();
  syncSettingsUI();
}

function switchPage(p){
  state.page = p;
  ['today','mood','meds','report','mine'].forEach(function(x){
    $('#page-'+x).hidden = (x !== p);
  });
  $$('#tabbar .tab').forEach(function(b){
    b.classList.toggle('on', b.getAttribute('data-page') === p);
  });
  if(p === 'today') renderToday();
  if(p === 'mood') renderMoodPage();
  if(p === 'meds') renderMeds();
  if(p === 'report') renderReport();
  if(p === 'mine') renderMine();
  window.scrollTo(0,0);
}
