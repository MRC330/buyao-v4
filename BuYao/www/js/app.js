/* ================================================================
 * 补药 3.0 · 交互层
 * ================================================================ */
'use strict';

/* ---------------- 打卡 ---------------- */
function toggleLog(medId, time){
  var t = today();
  var idx = -1;
  for(var i=0;i<DB.logs.length;i++){
    if(DB.logs[i].date===t && DB.logs[i].medId===medId && DB.logs[i].time===time){ idx = i; break; }
  }
  if(idx >= 0){
    DB.logs.splice(idx,1);
    toast('已撤销');
  }else{
    var med = getMed(medId);
    var dose = med ? parseFloat(med.dose) : 0;
    var unit = med ? (med.unit||'') : '';
    if(dose > 0 && med){
      med.stock = Math.max(0, (parseFloat(med.stock)||0) - dose);
    }
    DB.logs.push({ id:uid(), date:t, time:time, medId:medId, memberId:'me', ts:Date.now() });
    toast('记下了' + (dose > 0 ? (' · 库存剩 ' + (med ? med.stock : 0) + unit) : ''));
  }
  saveDB();
  renderToday();
  renderCalendar();
  renderReport();
}

function quickMood(v){
  saveMood(v, null, null);
  renderMoodQuick();
  toast('记下了');
}

function saveMood(score, effects, note){
  var t = today();
  var m = getMood(t);
  if(!m){
    m = { id:uid(), date:t, score:score||3, effects:[], note:'' };
    DB.moods.push(m);
  }
  if(score) m.score = score;
  if(effects) m.effects = effects;
  if(note != null) m.note = note;
  saveDB();
  return m;
}

/* ---------------- 成员 ---------------- */
function delMember(id){
  if(!confirm('删除这位同伴？相关记录会保留。')) return;
  DB.members = DB.members.filter(function(m){ return m.id !== id; });
  saveDB(); renderMine();
}

/* ---------------- 图片压缩 ---------------- */
function compressImage(file, cb){
  var reader = new FileReader();
  reader.onload = function(e){
    var img = new Image();
    img.onload = function(){
      var max = 800;
      var w = img.width, h = img.height;
      if(w > h && w > max){ h = Math.round(h*max/w); w = max; }
      else if(h >= w && h > max){ w = Math.round(w*max/h); h = max; }
      var c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img,0,0,w,h);
      try{ cb(c.toDataURL('image/jpeg', 0.72)); }
      catch(err){ cb(e.target.result); }
    };
    img.onerror = function(){ cb(e.target.result); };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

/* ================================================================
 * 药品表单
 * ================================================================ */
function openMedSheet(id){
  var med = id ? getMed(id) : null;
  var isNew = !med;
  if(isNew && !License.isPro() && DB.meds.length >= medLimit()){
    needPro('unlimited'); return;
  }
  var d = med || {
    name:'', spec:'', stock:'', unit:'片', dose:'', times:['08:00'],
    cat:'情绪', expiry:'', note:'', photo:'', risk:[], lowAt:7,
    enabled:true, startDate:'', memberId:'me'
  };
  state.draftMed = JSON.parse(JSON.stringify(d));
  state.draftMed.times = (d.times && d.times.length) ? d.times.slice() : ['08:00'];
  state.draftMed.risk  = (d.risk && d.risk.length) ? d.risk.slice() : [];

  var catOpts = CATS.filter(function(c){ return c !== '全部'; })
    .map(function(c){ return '<option value="'+esc(c)+'"'+(d.cat===c?' selected':'')+'>'+esc(c)+'</option>'; }).join('');

  var unitOpts = ['片','粒','袋','ml','支','g','次']
    .map(function(u){ return '<option value="'+u+'"'+(d.unit===u?' selected':'')+'>'+u+'</option>'; }).join('');

  openModal(isNew ? '添加' : d.name,
    '<div id="medForm">' +
      '<div class="field"><label>名称（自己看得懂就行）</label>' +
        '<input class="input" id="fName" value="'+esc(d.name)+'" placeholder="例如：早上的那颗"></div>' +

      '<div class="field"><label>包装照片（可拍照识别文字，仅本地识别）</label>' +
        '<div class="btn-row">' +
          '<button class="btn btn-line btn-sm" id="fPhotoBtn">'+ico('camera','ico-sm')+'拍照</button>' +
          '<button class="btn btn-line btn-sm" id="fAlbumBtn">'+ico('image','ico-sm')+'相册</button>' +
        '</div>' +
        '<input type="file" id="fPhoto" accept="image/*" capture="environment" hidden>' +
        '<input type="file" id="fAlbum" accept="image/*" hidden>' +
        '<div id="photoWrap">'+ (d.photo ? '<img class="ocr-preview" src="'+d.photo+'" id="photoImg">' : '') +'</div>' +
        '<div id="ocrBar" class="ocr-bar" hidden></div>' +
        '<div id="ocrOut" hidden></div>' +
      '</div>' +

      '<div class="f-row">' +
        '<div class="field"><label>每次用量</label><input class="input" id="fDose" type="number" inputmode="decimal" value="'+esc(d.dose)+'" placeholder="1"></div>' +
        '<div class="field"><label>单位</label><select class="select" id="fUnit">'+unitOpts+'</select></div>' +
      '</div>' +

      '<div class="field"><label>服用时间（可添加多个）</label><div id="timeList"></div>' +
        '<button class="btn btn-ghost btn-sm" id="fAddTime" style="margin-top:8px">'+ico('plus','ico-sm')+'添加时间</button></div>' +

      '<div class="f-row">' +
        '<div class="field"><label>当前库存</label><input class="input" id="fStock" type="number" inputmode="decimal" value="'+esc(d.stock)+'" placeholder="0"></div>' +
        '<div class="field"><label>低量提醒（天）</label><input class="input" id="fLow" type="number" inputmode="numeric" value="'+esc(d.lowAt)+'"></div>' +
      '</div>' +

      '<div class="field"><label>有效期至</label><input class="input" id="fExpiry" type="date" value="'+esc(d.expiry||'')+'"></div>' +

      '<div class="field"><label>分类</label><select class="select" id="fCat">'+catOpts+'</select></div>' +

      '<div class="field"><label>标记（可多选，只是提醒自己）</label><div class="chips" id="riskChips"></div></div>' +

      '<div class="field"><label>备注</label><textarea class="textarea" id="fNote" placeholder="想记的都可以写">'+esc(d.note||'')+'</textarea></div>' +

      '<label class="sw"><div class="sw-l"><div class="sw-t">启用提醒</div></div>' +
        '<input type="checkbox" id="fEnabled"'+(d.enabled!==false?' checked':'')+'><i></i></label>' +

      '<div class="btn-row" style="margin-top:16px">' +
        (isNew ? '' : '<button class="btn btn-ghost" id="fDel" style="background:var(--danger-soft);color:var(--danger)">删除</button>') +
        '<button class="btn btn-primary" id="fSave">保存</button>' +
      '</div>' +
      '<div style="height:10px"></div>' +
    '</div>',
    function(){
      bindMedForm(isNew, id);
    });
}

function bindMedForm(isNew, id){
  var dm = state.draftMed;

  function renderTimes(){
    $('#timeList').innerHTML = dm.times.map(function(t,i){
      return '<div class="row" style="padding:8px 0">' +
        '<div class="row-main"><input class="input" type="time" data-ti="'+i+'" value="'+esc(t)+'" style="padding:9px 12px"></div>' +
        (dm.times.length > 1 ? '<button class="btn btn-ghost btn-sm" data-tdel="'+i+'">删除</button>' : '') +
      '</div>';
    }).join('');
    $$('#timeList input[type=time]').forEach(function(inp){
      inp.onchange = function(){ dm.times[parseInt(inp.getAttribute('data-ti'),10)] = inp.value; };
    });
    $$('#timeList [data-tdel]').forEach(function(b){
      b.onclick = function(){ dm.times.splice(parseInt(b.getAttribute('data-tdel'),10),1); renderTimes(); };
    });
  }
  renderTimes();

  $('#fAddTime').onclick = function(){
    dm.times.push(dm.times.length ? '20:00' : '08:00');
    renderTimes();
  };

  $('#riskChips').innerHTML = RISKS.map(function(r){
    return '<button class="chip-eff'+(dm.risk.indexOf(r)>=0?' on':'')+'" data-r="'+esc(r)+'">'+esc(r)+'</button>';
  }).join('');
  $$('#riskChips .chip-eff').forEach(function(b){
    b.onclick = function(){
      var r = b.getAttribute('data-r');
      var i = dm.risk.indexOf(r);
      if(i>=0) dm.risk.splice(i,1); else dm.risk.push(r);
      b.classList.toggle('on');
    };
  });

  /* 拍照 / 相册 */
  function pick(inp){
    inp.onchange = function(){
      var f = inp.files && inp.files[0];
      if(!f) return;
      compressImage(f, function(dataUrl){
        dm.photo = dataUrl;
        $('#photoWrap').innerHTML = '<img class="ocr-preview" src="'+dataUrl+'" id="photoImg">';
        autoOcr(dataUrl);
      });
    };
    inp.click();
  }
  $('#fPhotoBtn').onclick = function(){ pick($('#fPhoto')); };
  $('#fAlbumBtn').onclick = function(){ pick($('#fAlbum')); };

  /* OCR */
  function autoOcr(dataUrl){
    var bar = $('#ocrBar'), out = $('#ocrOut');
    bar.hidden = false; out.hidden = true;
    runOcr(dataUrl,
      function(text, cls){
        bar.className = 'ocr-bar ' + (cls||'');
        bar.innerHTML = (cls === 'loading' ? '<span class="spin"></span>' : '') + '<span>'+esc(text)+'</span>';
      },
      function(text){
        var r = extractFromOcr(text);
        bar.className = 'ocr-bar ok';
        out.hidden = false;
        if(r.cands.length || r.dates.length){
          bar.innerHTML = '<span>识别完成，点下面的文字填入</span>';
          var h = '';
          if(r.cands.length){
            h += '<div class="hint" style="margin-top:10px">可能是名称：</div><div class="ocr-hits">' +
              r.cands.map(function(c){ return '<button class="ocr-hit" data-name="'+esc(c)+'">'+esc(c)+'</button>'; }).join('') + '</div>';
          }
          if(r.dates.length){
            h += '<div class="hint" style="margin-top:10px">识别到的日期：</div><div class="ocr-hits">' +
              r.dates.map(function(c){
                var norm = c.replace(/年|月/g,'-').replace(/日|\./g,'');
                return '<button class="ocr-hit" data-date="'+esc(norm)+'">'+esc(c)+'</button>';
              }).join('') + '</div>';
          }
          h += '<div class="hint" style="margin-top:10px">原始文字（仅供参考）：</div><div class="ocr-text">'+esc(r.raw.slice(0,400))+'</div>';
          out.innerHTML = h;
          $$('#ocrOut [data-name]').forEach(function(b){
            b.onclick = function(){ $('#fName').value = b.getAttribute('data-name'); toast('已填入名称'); };
          });
          $$('#ocrOut [data-date]').forEach(function(b){
            b.onclick = function(){ $('#fExpiry').value = b.getAttribute('data-date'); toast('已填入有效期'); };
          });
        }else{
          bar.className = 'ocr-bar err';
          bar.innerHTML = '<span>没认出来，直接手动填写吧</span>';
          out.innerHTML = '<div class="ocr-text">'+esc(text.slice(0,400))+'</div>';
        }
      });
  }

  /* 保存 */
  $('#fSave').onclick = function(){
    var name = $('#fName').value.trim();
    if(!name){ toast('请填写名称'); return; }
    var t = dm.times.filter(function(x){ return x; }).sort();
    if(!t.length) t = ['08:00'];

    var obj = {
      name: name,
      spec: '',
      dose: parseFloat($('#fDose').value) || 0,
      unit: $('#fUnit').value,
      times: t,
      stock: parseFloat($('#fStock').value) || 0,
      lowAt: parseInt($('#fLow').value, 10) || 7,
      expiry: $('#fExpiry').value || '',
      cat: $('#fCat').value,
      note: $('#fNote').value,
      photo: dm.photo || '',
      risk: dm.risk.slice(),
      enabled: $('#fEnabled').checked,
      memberId: 'me'
    };

    if(isNew){
      obj.id = uid();
      obj.startDate = today();
      DB.meds.push(obj);
      if(!DB.settings.startDate) DB.settings.startDate = today();
      toast('已添加');
    }else{
      var m = getMed(id);
      Object.assign(m, obj);
      toast('已保存');
    }
    saveDB();
    closeModal();
    renderAll();
  };

  if(!isNew){
    $('#fDel').onclick = function(){
      if(!confirm('删除「' + getMed(id).name + '」？打卡记录会保留。')) return;
      DB.meds = DB.meds.filter(function(m){ return m.id !== id; });
      saveDB(); closeModal(); renderAll();
      toast('已删除');
    };
  }
}

/* ================================================================
 * 医生表单
 * ================================================================ */
function openDoctorSheet(id){
  var d = id ? DB.doctors.filter(function(x){ return x.id===id; })[0] : null;
  var o = d || { name:'', hospital:'', dept:'', phone:'', nextVisit:'', note:'' };
  openModal(id ? '编辑医生' : '添加医生',
    '<div class="field"><label>姓名</label><input class="input" id="dName" value="'+esc(o.name)+'"></div>' +
    '<div class="field"><label>医院 / 机构</label><input class="input" id="dHos" value="'+esc(o.hospital)+'"></div>' +
    '<div class="field"><label>科室</label><input class="input" id="dDept" value="'+esc(o.dept)+'" placeholder="例如：精神科"></div>' +
    '<div class="field"><label>下次复诊</label><input class="input" id="dNext" type="date" value="'+esc(o.nextVisit||'')+'"></div>' +
    '<div class="field"><label>备注</label><textarea class="textarea" id="dNote">'+esc(o.note||'')+'</textarea></div>' +
    '<div class="btn-row">' +
      (id ? '<button class="btn btn-ghost" id="dDel" style="background:var(--danger-soft);color:var(--danger)">删除</button>' : '') +
      '<button class="btn btn-primary" id="dSave">保存</button></div>' +
    '<div style="height:10px"></div>',
    function(){
      $('#dSave').onclick = function(){
        var v = {
          name: $('#dName').value.trim(),
          hospital: $('#dHos').value.trim(),
          dept: $('#dDept').value.trim(),
          nextVisit: $('#dNext').value,
          note: $('#dNote').value
        };
        if(!v.name){ toast('请填写姓名'); return; }
        if(id) Object.assign(DB.doctors.filter(function(x){ return x.id===id; })[0], v);
        else { v.id = uid(); DB.doctors.push(v); }
        saveDB(); closeModal(); renderMine(); renderToday();
        toast('已保存');
      };
      if(id) $('#dDel').onclick = function(){
        DB.doctors = DB.doctors.filter(function(x){ return x.id !== id; });
        saveDB(); closeModal(); renderMine(); renderToday();
      };
    });
}

/* ================================================================
 * 提醒设置（多渠道）
 * ================================================================ */
function openRemindSheet(){
  var ch = DB.settings.channels || {};
  var co = DB.settings.contacts || {};

  function row(key, icon, name, desc, needPro_){
    var locked = needPro_ && !License.isPro();
    return '<label class="sw"><div class="sw-l"><div class="sw-t">'+esc(name)+
      (locked?' <span class="badge badge-pink">会员</span>':'')+'</div>'+
      '<div class="sw-d">'+esc(desc)+'</div></div>'+
      '<input type="checkbox" data-ch="'+key+'"'+((ch[key]&&!locked)?' checked':'')+
      (locked?' data-locked="1"':'')+'><i></i></label>';
  }

  openModal('提醒方式',
    '<div class="privacy" style="margin-bottom:14px">'+ico('shield','ico-sm')+
      '<div>提醒脱敏开启后，通知里只会出现「记得今天的份」，不会显示任何名称。</div></div>' +

    row('app','bell','应用内提醒','基础提醒，永久免费', false) +
    row('wechat','msg','微信提醒','通过服务号推送（需先绑定）', true) +
    row('sms','sms','短信提醒','到达率最高，有通道成本', true) +
    row('email','mail','邮箱提醒','适合做长期记录备份', true) +

    '<div class="sec-title">联系方式（仅用于发送提醒）</div>' +
    '<div class="field"><label>手机号</label><input class="input" id="cPhone" value="'+esc(co.phone||'')+'" placeholder="用于短信提醒" inputmode="tel"></div>' +
    '<div class="field"><label>邮箱</label><input class="input" id="cMail" value="'+esc(co.email||'')+'" placeholder="用于邮件提醒" inputmode="email"></div>' +
    '<div class="field"><label>微信号</label><input class="input" id="cWechat" value="'+esc(co.wechat||'')+'" placeholder="用于关联服务号"></div>' +

    '<div class="sec-title">其他</div>' +
    '<label class="sw"><div class="sw-l"><div class="sw-t">提醒脱敏</div>' +
      '<div class="sw-d">通知不显示名称，保护隐私</div></div>' +
      '<input type="checkbox" id="rMask"'+(DB.settings.mask?' checked':'')+'><i></i></label>' +
    '<label class="sw"><div class="sw-l"><div class="sw-t">提示音</div></div>' +
      '<input type="checkbox" id="rSound"'+(DB.settings.sound?' checked':'')+'><i></i></label>' +

    '<div class="sec-title">自定义提醒文案（会员）</div>' +
    '<div class="field"><input class="input" id="rText" value="'+esc(DB.settings.reminderText||'')+'" placeholder="例如：今天也要好好吃饭"'+(License.isPro()?'':' disabled')+'></div>' +
    (License.isPro() ? '' : '<div class="hint" style="margin-top:-6px">这是会员功能，输入兑换码解锁</div>') +

    '<button class="btn btn-primary" id="rSave" style="margin-top:16px">保存</button>' +
    '<div class="hint" style="margin-top:12px">联系方式只在你主动开启对应渠道后才会被使用。' +
      '若未配置验证服务，这些数据不会离开你的手机。</div>' +
    '<div style="height:10px"></div>',
    function(){
      $$('[data-ch]').forEach(function(inp){
        inp.onchange = function(){
          if(inp.getAttribute('data-locked')){
            inp.checked = false;
            needPro('multi_channel');
          }
        };
      });
      $('#rSave').onclick = function(){
        $$('[data-ch]').forEach(function(inp){
          if(!inp.getAttribute('data-locked')) ch[inp.getAttribute('data-ch')] = inp.checked;
        });
        DB.settings.contacts = {
          phone: $('#cPhone').value.trim(),
          email: $('#cMail').value.trim(),
          wechat: $('#cWechat').value.trim()
        };
        DB.settings.mask = $('#rMask').checked;
        DB.settings.sound = $('#rSound').checked;
        if(License.isPro()) DB.settings.reminderText = ($('#rText').value || '').trim();
        saveDB(); closeModal(); renderMine(); syncSettingsUI(); syncNativeReminders();
        toast('已保存');
      };
    });
}

/* ================================================================
 * 合规与说明
 * ================================================================ */
function openComplianceSheet(){
  openModal('合规与隐私',
    '<div class="acc open"><div class="acc-h">'+ico('lock','ico-sm')+'<span>一、产品定位</span></div>' +
    '<div class="acc-b">本应用是一个<b>个人健康信息记录工具</b>：只帮你记录自己填写的内容，' +
    '<b>不做任何评估、诊断、判断、建议、筛查或预测</b>。' +
    '它不能替代医生的诊断与治疗，也不构成任何医疗建议。</div></div>' +

    '<div class="acc open"><div class="acc-h">'+ico('pill','ico-sm')+'<span>二、不含药品信息</span></div>' +
    '<div class="acc-b"><ol>' +
    '<li>应用内<b>不含任何药品数据库</b>，不提供药品名称、适应症、用法用量、不良反应、说明书等信息；</li>' +
    '<li>所有内容均由<b>用户自行录入</b>，属个人数据记录行为；</li>' +
    '<li>拍照识别（OCR）仅将包装上的文字识别后<b>回填至用户自有字段</b>，不提供识别结果的释义、扩展或推荐，属通用文字识别；</li>' +
    '<li>应用<b>不提供</b>任何用药建议、剂量指导、相互作用提示或疗效判断。</li>' +
    '</ol><p style="margin-top:8px">依据《互联网药品信息服务管理办法》及国家药监局 2025 年 12 月《互联网药品医疗器械信息服务备案管理规定》，' +
    '本产品不构成互联网药品信息服务。</p></div></div>' +

    '<div class="acc open"><div class="acc-h">'+ico('shield','ico-sm')+'<span>三、数据在哪里</span></div>' +
    '<div class="acc-b">服药记录、心情记录、身体反应、备注与照片<b>全部仅保存在本机</b>，' +
    '不上传服务器、不共享给第三方。<br><br>' +
    '若你主动开启了微信 / 短信 / 邮箱提醒，则<b>仅提醒时间与脱敏文案</b>会经由相应通道送达，' +
    '健康内容不会随之传输。<br><br>' +
    '兑换码激活时，仅向验证服务发送<b>兑换码与设备标识</b>，不含任何健康数据。</div></div>' +

    '<div class="acc open"><div class="acc-h">'+ico('info','ico-sm')+'<span>四、适用人群</span></div>' +
    '<div class="acc-b">本应用面向 <b>18 周岁以上</b>人群，不面向未成年人，不收集未成年人个人信息。</div></div>' +

    '<div class="sos" style="margin-top:14px">'+ico('phone')+
      '<div class="sos-t"><b>需要有人聊聊吗</b>全国心理援助热线 · 24 小时免费</div>' +
      '<button class="sos-btn" onclick="callSos()">12356</button></div>' +
    '<div style="height:10px"></div>');
}

function openDisclaimer(force){
  openModal('使用须知',
    '<p class="hint" style="font-size:14px;line-height:1.8;margin-bottom:16px">' +
      '在开始之前，有几件事想先说清楚。</p>' +

    '<div class="alert alert-info">'+ico('info','ico-sm')+
      '<div>补药是一个<b>记录工具</b>。它只帮你记住自己填写的东西，' +
      '<b>不会对你的状况做任何评估或判断</b>，也不能替代医生。</div></div>' +

    '<div class="alert alert-warn">'+ico('alert','ico-sm')+
      '<div>任何关于<b>开始、停止、增减药量</b>的决定，都必须由你的医生做出。' +
      '尤其是精神类用药，<b>骤停可能带来明显不适</b>，务必在医生指导下逐步减量。</div></div>' +

    '<div class="alert alert-pink">'+ico('phone','ico-sm')+
      '<div>如果你正处在很难受的状态，或有伤害自己的念头，请立刻联系身边的人，' +
      '或拨打全国心理援助热线 <b>12356</b>（24 小时 · 免费）。</div></div>' +

    '<div class="privacy">'+ico('shield','ico-sm')+
      '<div>所有记录只保存在你的手机里，不上传服务器。</div></div>' +

    '<label class="sw" style="margin-top:16px"><div class="sw-l">' +
      '<div class="sw-t">我已年满 18 周岁</div>' +
      '<div class="sw-d">本应用不面向未成年人</div></div>' +
      '<input type="checkbox" id="ageOk"><i></i></label>' +

    '<button class="btn btn-primary" id="okBtn" style="margin-top:16px">我明白了，开始使用</button>' +
    (force ? '' : '<button class="btn btn-ghost btn-sm" style="margin-top:10px;width:100%" onclick="closeModal()">关闭</button>') +
    '<div style="height:10px"></div>',
    function(){
      $('#okBtn').onclick = function(){
        if(!$('#ageOk').checked){ toast('请确认你已年满 18 周岁'); return; }
        DB.settings.disclaimerAt = Date.now();
        saveDB();
        closeModal();
      };
    });
}

function callSos(){
  if(confirm('拨打全国心理援助热线 12356？\n\n24 小时 · 免费 · 保密')){
    location.href = 'tel:12356';
  }
}
function openSos(){ callSos(); }

/* ================================================================
 * 备份
 * ================================================================ */
function exportJSON(){
  var data = JSON.stringify(DB, null, 2);
  var blob = new Blob([data], { type:'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '补药备份-' + today() + '.json';
  document.body.appendChild(a); a.click();
  setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 500);
  toast('已导出备份文件');
}

function exportCSV(){
  var rows = [['日期','时间','名称','用量','单位','成员']];
  DB.logs.slice().sort(function(a,b){ return a.date < b.date ? 1 : -1; }).forEach(function(l){
    var m = getMed(l.medId);
    rows.push([l.date, l.time, m ? m.name : '已删除', m ? m.dose : '', m ? m.unit : '', memberName(l.memberId)]);
  });
  var csv = '\ufeff' + rows.map(function(r){
    return r.map(function(c){ return '"' + String(c).replace(/"/g,'""') + '"'; }).join(',');
  }).join('\n');
  var blob = new Blob([csv], { type:'text/csv;charset=utf-8' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '补药打卡-' + today() + '.csv';
  document.body.appendChild(a); a.click();
  setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 500);
  toast('已导出 CSV');
}

function importJSON(file){
  var r = new FileReader();
  r.onload = function(e){
    try{
      var d = JSON.parse(e.target.result);
      if(!d || !d.meds) throw new Error('格式不对');
      if(!confirm('导入会覆盖当前数据，确定继续？')) return;
      DB.meds = d.meds || [];
      DB.logs = d.logs || [];
      DB.moods = d.moods || [];
      DB.members = d.members || [];
      DB.doctors = d.doctors || [];
      if(d.settings) DB.settings = Object.assign({}, DB.settings, d.settings);
      saveDB(); renderAll();
      toast('导入成功');
    }catch(err){ toast('导入失败：' + err.message); }
  };
  r.readAsText(file);
}

/* ================================================================
 * 设置同步
 * ================================================================ */
function syncSettingsUI(){
  var s = DB.settings;
  if($('#swDark')) $('#swDark').checked = s.theme === 'dark';
  if($('#swSound')) $('#swSound').checked = !!s.sound;
  if($('#swNotify')) $('#swNotify').checked = !!s.notify;
  if($('#swMask')) $('#swMask').checked = !!s.mask;
}

/* ================================================================
 * 初始化
 * ================================================================ */
function init(){
  loadDB();
  License.load();
  applyTheme();

  /* 顶部 */
  $('#btnSettings').onclick = function(){ switchPage('mine'); };
  $('#btnSos').onclick = callSos;

  /* 底部导航 */
  $$('#tabbar .tab').forEach(function(b){
    b.onclick = function(){ switchPage(b.getAttribute('data-page')); };
  });

  /* 药品 */
  $('#btnAddMed').onclick = function(){ openMedSheet(null); };
  $('#medSearch').oninput = function(){ state.search = this.value.trim(); renderMeds(); };

  /* 心情 */
  $('#btnSaveMood').onclick = function(){
    if(!state.draftMood.score){ toast('先选一个现在的感觉'); return; }
    saveMood(state.draftMood.score, state.draftMood.effects, $('#moodNote').value);
    toast('已保存今天的记录');
    renderMoodQuick(); renderMoodPage();
  };

  /* 日历 */
  $('#calPrev').onclick = function(){
    state.calM--; if(state.calM < 0){ state.calM = 11; state.calY--; }
    renderCalendar();
  };
  $('#calNext').onclick = function(){
    state.calM++; if(state.calM > 11){ state.calM = 0; state.calY++; }
    renderCalendar();
  };

  /* 我的 · 各入口 */
  $('#btnRemindSet').onclick = openRemindSheet;
  $('#btnAddMember').onclick = function(){
    openModal('添加同伴',
      '<div class="field"><label>称呼</label><input class="input" id="mName" placeholder="例如：妈妈"></div>' +
      '<div class="field"><label>关系</label><input class="input" id="mRel" placeholder="例如：家人 / 朋友"></div>' +
      '<button class="btn btn-primary" id="mSave">添加</button><div style="height:10px"></div>',
      function(){
        $('#mSave').onclick = function(){
          var n = $('#mName').value.trim();
          if(!n){ toast('请填写称呼'); return; }
          if(!License.isPro()){ needPro('buddy'); return; }
          DB.members.push({ id:uid(), name:n, relation:$('#mRel').value.trim(), color:'#8FC7FF' });
          saveDB(); closeModal(); renderMine(); toast('已添加');
        };
      });
  };
  $('#btnAddDoctor').onclick = function(){ openDoctorSheet(null); };

  $$('[data-go]').forEach(function(el){
    el.onclick = function(){
      var g = el.getAttribute('data-go');
      if(g === 'compliance') openComplianceSheet();
      if(g === 'disclaimer') openDisclaimer(false);
      if(g === 'sos') callSos();
    };
  });

  /* 设置开关 */
  $('#swDark').onchange = function(){
    DB.settings.theme = this.checked ? 'dark' : 'light';
    saveDB(); applyTheme();
  };
  $('#swSound').onchange = function(){ DB.settings.sound = this.checked; saveDB(); };
  $('#swMask').onchange = function(){ DB.settings.mask = this.checked; saveDB(); renderToday(); };
  $('#swNotify').onchange = function(){
    var self = this;
    if(this.checked){
      if(!window.Notification){ toast('当前环境不支持系统通知'); self.checked = false; return; }
      Notification.requestPermission().then(function(p){
        if(p !== 'granted'){ toast('未获得通知权限'); self.checked = false; DB.settings.notify = false; saveDB(); }
        else { DB.settings.notify = true; saveDB(); toast('已开启系统通知'); }
      });
    }else{
      DB.settings.notify = false; saveDB();
    }
  };
  $('#btnTestRemind').onclick = function(){
    showReminder({ med:{ name:'测试', dose:'' }, time: nowHM() });
  };
  $('#btnReset').onclick = function(){
    if(!confirm('清空全部数据？建议先导出备份。')) return;
    if(!confirm('再确认一次：所有记录都会被删除，且无法恢复。')) return;
    localStorage.removeItem(DB_KEY);
    localStorage.removeItem('xinqing_license');
    location.reload();
  };

  /* 报告 */
  $('#btnGenReport').onclick = function(){
    $('#reportBox').textContent = buildReport();
    $('#reportBox').hidden = false;
    $('#reportActs').hidden = false;
    $('#reportHint').textContent = '已生成，可以复制或分享给医生。';
  };
  $('#btnCopyReport').onclick = function(){
    var t = $('#reportBox').textContent;
    if(!can('report_export')){ needPro('report_export'); return; }
    copyText(t);
  };
  $('#btnShareReport').onclick = function(){
    if(!can('report_export')){ needPro('report_export'); return; }
    shareText('补药 · 复诊记录', $('#reportBox').textContent);
  };

  /* 备份 */
  $('#btnExport').onclick = exportJSON;
  $('#btnExportCsv').onclick = function(){
    if(!can('csv')){ needPro('csv'); return; }
    exportCSV();
  };
  $('#btnImport').onclick = function(){ $('#importFile').click(); };
  $('#importFile').onchange = function(){ if(this.files[0]) importJSON(this.files[0]); };

  /* 提醒弹窗 */
  $('#btnTaken').onclick = function(){
    if(pendingRemind){
      toggleLog(pendingRemind.med.id, pendingRemind.time);
    }
    $('#reminderOverlay').hidden = true;
    pendingRemind = null;
  };
  $('#btnSnooze').onclick = function(){
    DB.settings.snoozeUntil = pad2(new Date(Date.now()+10*60000).getHours()) + ':' + pad2(new Date(Date.now()+10*60000).getMinutes());
    saveDB();
    $('#reminderOverlay').hidden = true;
    pendingRemind = null;
    toast('10 分钟后再提醒你');
  };

  /* 首次启动 */
  if(!DB.settings.disclaimerAt){
    setTimeout(function(){ openDisclaimer(true); }, 400);
  }

  renderAll();
  switchPage('today');

  /* 定时检查 */
  setInterval(checkReminders, 20000);
  setTimeout(checkReminders, 1500);

  /* 跨天刷新 */
  var lastDay = today();
  setInterval(function(){
    if(today() !== lastDay){ lastDay = today(); renderAll(); }
  }, 60000);
}

function copyText(t){
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(t).then(function(){ toast('已复制到剪贴板'); },
      function(){ fallbackCopy(t); });
  }else fallbackCopy(t);
}
function fallbackCopy(t){
  var ta = document.createElement('textarea');
  ta.value = t; document.body.appendChild(ta); ta.select();
  try{ document.execCommand('copy'); toast('已复制'); }catch(e){ toast('复制失败'); }
  ta.remove();
}
function shareText(title, text){
  if(navigator.share){
    navigator.share({ title:title, text:text })['catch'](function(){});
  }else copyText(text);
}

document.addEventListener('DOMContentLoaded', init);
if(document.readyState === 'complete' || document.readyState === 'interactive'){
  setTimeout(function(){ if(!DB.meds && !DB.settings.disclaimerAt) init(); }, 0);
}
