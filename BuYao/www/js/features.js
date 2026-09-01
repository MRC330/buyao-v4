/* ================================================================
 * 补药 3.0 · 功能模块
 * 会员与兑换码 / 科普内容 / 报告生成 / 图表
 * ================================================================ */
'use strict';

/* ================================================================
 * 一、轻量 SHA-256 + HMAC（纯 JS，无依赖）
 * ================================================================ */
var SHA256 = (function(){
  var K = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
  ];
  function rotr(x,n){ return (x >>> n) | (x << (32-n)); }
  /* 标准 UTF-8 编码：字符串 -> 字节数组（HMAC 必须按字节运算） */
  function utf8Bytes(str){
    var out = [], i, c;
    for(i=0;i<str.length;i++){
      c = str.charCodeAt(i);
      if(c < 0x80) out.push(c);
      else if(c < 0x800) out.push(0xC0 | (c>>6), 0x80 | (c & 0x3F));
      else if(c < 0xD800 || c >= 0xE000) out.push(0xE0 | (c>>12), 0x80 | ((c>>6)&0x3F), 0x80 | (c&0x3F));
      else{
        i++;
        c = 0x10000 + (((c & 0x3FF) << 10) | (str.charCodeAt(i) & 0x3FF));
        out.push(0xF0 | (c>>18), 0x80 | ((c>>12)&0x3F), 0x80 | ((c>>6)&0x3F), 0x80 | (c&0x3F));
      }
    }
    return out;
  }
  function hashBytes(m){
    m = m.slice();
    var i;
    var l = m.length * 8;
    m.push(0x80);
    while(m.length % 64 !== 56) m.push(0);
    for(i=7;i>=0;i--) m.push((l / Math.pow(256,i)) & 0xff);
    m[m.length-1] = l & 0xff;
    var H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    var w = new Array(64);
    for(i=0;i<m.length;i+=64){
      var a=H[0],b=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7],t;
      for(t=0;t<64;t++){
        if(t<16) w[t] = (m[i+t*4]<<24)|(m[i+t*4+1]<<16)|(m[i+t*4+2]<<8)|m[i+t*4+3];
        else{
          var s0 = rotr(w[t-15],7)^rotr(w[t-15],18)^(w[t-15]>>>3);
          var s1 = rotr(w[t-2],17)^rotr(w[t-2],19)^(w[t-2]>>>10);
          w[t] = (w[t-16] + s0 + w[t-7] + s1) >>> 0;
        }
        var S1 = rotr(e,6)^rotr(e,11)^rotr(e,25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K[t] + w[t]) >>> 0;
        var S0 = rotr(a,2)^rotr(a,13)^rotr(a,22);
        var mj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + mj) >>> 0;
        h=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
      }
      H[0]=(H[0]+a)>>>0; H[1]=(H[1]+b)>>>0; H[2]=(H[2]+c)>>>0; H[3]=(H[3]+d)>>>0;
      H[4]=(H[4]+e)>>>0; H[5]=(H[5]+f)>>>0; H[6]=(H[6]+g)>>>0; H[7]=(H[7]+h)>>>0;
    }
    return H.map(function(x){ return ('00000000'+x.toString(16)).slice(-8); }).join('');
  }
  function hash(msg){ return hashBytes(utf8Bytes(msg)); }
  return { hash: hash, hashBytes: hashBytes, utf8Bytes: utf8Bytes };
})();

function hexToBytes(hex){
  var out = [];
  for(var i=0;i<hex.length;i+=2) out.push(parseInt(hex.substr(i,2),16));
  return out;
}

/* HMAC-SHA256：严格按字节运算，与服务端 / 生成器实现一致 */
function hmacSha256(key, msg){
  var bs = 64, i;
  var kb = SHA256.utf8Bytes(key);
  if(kb.length > bs) kb = hexToBytes(SHA256.hashBytes(kb));
  var ipad = [], opad = [];
  for(i=0;i<bs;i++){
    var b = kb[i] || 0;
    ipad.push(b ^ 0x36);
    opad.push(b ^ 0x5c);
  }
  var mb = SHA256.utf8Bytes(msg);
  var inner = hexToBytes(SHA256.hashBytes(ipad.concat(mb)));
  return SHA256.hashBytes(opad.concat(inner));
}

/* ================================================================
 * 二、会员与兑换码
 * ---------------------------------------------------------------
 * 码格式：XQ + 套餐位 + 6 位随机 + 6 位校验（Base32）
 *   套餐位：P 永久 / Y 一年 / M 一月 / G 公益（永久）
 * 校验：HMAC-SHA256(SECRET, 套餐位+随机) 取前 6 位 Base32
 *
 * 安全说明：前端密钥可被逆向，本方案用于提升使用门槛与离线可用性。
 * 正式商用请在「设置 → 会员与兑换」中填写验证服务地址，切换为在线校验。
 * ================================================================ */
/* Crockford Base32：正好 32 个字符，缺一个都会导致索引越界 */
var B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/* 生成随机段时使用的安全子集：剔除 0/1/I/L/O/U，避免用户抄错 */
var B32_SAFE = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

/* 归一化用户输入：O→0、I/L→1，并去掉分隔符 */
function normCode(s){
  return String(s == null ? '' : s).toUpperCase()
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/[^A-Z0-9]/g, '');
}

function b32encode(hex, len){
  var bits = '', out = '';
  for(var i=0;i<hex.length;i++){
    bits += ('0000' + parseInt(hex[i],16).toString(2)).slice(-4);
  }
  for(var j=0;j<bits.length;j+=5){
    var chunk = bits.substr(j,5);
    while(chunk.length < 5) chunk += '0';
    out += B32[parseInt(chunk,2)];
  }
  return out.slice(0, len);
}

/* 密钥：建议上线前替换为自己的字符串（生成器与 App 保持一致即可） */
var LICENSE_SECRET = 'xinqing-3.0-keep-it-secret-change-me';
/* 在线校验服务地址（部署好 ECS 后填写，如 https://你的域名或IP/api/redeem）
 * 留空 → 走「设置→会员与兑换」里填写的地址；都没配 → 本地校验（不防重复） */
var LICENSE_SERVER = 'http://120.26.34.215:8080/api/redeem';

function makeSignature(plan, rand){
  var h = hmacSha256(LICENSE_SECRET, plan + rand);
  return b32encode(h, 6);
}

/* 本地校验：返回 {ok, plan} 或 {ok:false, reason} */
function verifyCodeLocal(code){
  if(!code) return { ok:false, reason:'请输入兑换码' };
  var c = normCode(code);
  if(c.indexOf('XQ') === 0) c = c.slice(2);
  if(c.length !== 13) return { ok:false, reason:'兑换码格式不对' };
  var plan = c[0];
  if('PYMG'.indexOf(plan) < 0) return { ok:false, reason:'兑换码格式不对' };
  var rand  = c.substr(1,6);
  var check = c.substr(7,6);
  if(makeSignature(plan, rand) !== check){
    return { ok:false, reason:'兑换码无效，请检查后重试' };
  }
  return { ok:true, plan:plan };
}

/* 在线校验（可选）：配置了服务地址时优先使用 */
function verifyCodeOnline(code, cb){
  var url = (LICENSE_SERVER || DB.settings.licenseServer || '').trim();
  if(!url){ cb(null); return; }               // 未配置 → 交给本地校验
  var fp = deviceFingerprint();
  var timer = setTimeout(function(){ cb(null); }, 6000);  // 超时降级为本地校验
  try{
    var xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Content-Type','application/json');
    xhr.onreadystatechange = function(){
      if(xhr.readyState !== 4) return;
      clearTimeout(timer);
      if(xhr.status === 200){
        try{
          var r = JSON.parse(xhr.responseText);
          cb({ ok: !!r.ok, plan: r.plan || 'P', expiry: r.expiry || '', reason: r.reason || '' });
        }catch(e){ cb(null); }
      } else cb(null);
    };
    xhr.send(JSON.stringify({ code: code, device: fp, app:'xinqing', v:3 }));
  }catch(e){ clearTimeout(timer); cb(null); }
}

/* 退出会员时通知服务端释放设备名额，换机后原码可继续使用 */
function releaseOnline(){
  var url = (LICENSE_SERVER || DB.settings.licenseServer || '').trim();
  var code = License.state.code || '';
  if(!url || !code) return;
  var fp = deviceFingerprint();
  try{
    var xhr = new XMLHttpRequest();
    xhr.open('POST', url.replace(/\/api\/redeem\s*$/, '/api/release'), true);
    xhr.setRequestHeader('Content-Type','application/json');
    xhr.send(JSON.stringify({ code: code, device: fp, app:'xinqing', v:3 }));
  }catch(e){}
}

/* 设备指纹：仅用于防止兑换码无限扩散，不含任何健康信息 */
function deviceFingerprint(){
  try{
    var raw = [
      navigator.userAgent,
      screen.width + 'x' + screen.height,
      (navigator.language||''),
      (new Date().getTimezoneOffset())
    ].join('|');
    return SHA256.hash(raw).slice(0, 16);
  }catch(e){ return 'unknown'; }
}

var PLAN_DAYS = { P: 0, G: 0, Y: 365, M: 30 };
var PLAN_NAME = { P:'永久会员', G:'公益会员', Y:'年度会员', M:'月度会员' };

var License = {
  state: { tier:'free', plan:'', code:'', at:0, expiry:'', device:'' },

  load: function(){
    try{
      var raw = localStorage.getItem('xinqing_license');
      if(raw) this.state = Object.assign(this.state, JSON.parse(raw));
    }catch(e){}
    this.checkExpiry();
  },
  save: function(){
    try{ localStorage.setItem('xinqing_license', JSON.stringify(this.state)); }catch(e){}
  },
  checkExpiry: function(){
    var s = this.state;
    if(s.tier === 'pro' && s.expiry && daysTo(s.expiry) < 0){
      s.tier = 'free'; s.plan = ''; s.expiry = '';
      this.save();
      toast('会员已到期，已恢复为免费版');
    }
  },
  isPro: function(){ return this.state.tier === 'pro'; },
  planName: function(){
    return this.isPro() ? (PLAN_NAME[this.state.plan] || '会员') : '免费版';
  },
  expiryText: function(){
    var s = this.state;
    if(!this.isPro()) return '';
    if(!s.expiry) return '长期有效';
    var d = daysTo(s.expiry);
    return d >= 0 ? ('剩余 ' + d + ' 天') : '已到期';
  },
  /* 兑换入口：先尝试在线，失败或未配置则本地校验 */
  redeem: function(code, cb){
    var self = this;
    verifyCodeOnline(code, function(online){
      var r = online || verifyCodeLocal(code);
      if(!r.ok){ cb({ ok:false, reason: r.reason || '兑换码无效' }); return; }
      var days = PLAN_DAYS[r.plan] || 0;
      self.state.tier = 'pro';
      self.state.plan  = r.plan;
      self.state.code  = String(code).toUpperCase();
      self.state.at    = Date.now();
      self.state.expiry = days ? addDays(today(), days) : (r.expiry || '');
      self.state.device = deviceFingerprint();
      self.save();
      cb({ ok:true, plan: r.plan });
    });
  },
  revoke: function(){
    releaseOnline();   // 通知服务端释放名额，方便换机后重新激活
    this.state = { tier:'free', plan:'', code:'', at:0, expiry:'', device:'' };
    this.save();
  }
};

/* ---------------- 会员权限表 ----------------
 * 原则：核心的服药提醒与记录永远免费。
 * 收费的只有「有真实成本」或「高感知增值」的部分。
 */
var PRO_FEATURES = {
  multi_channel: { name:'多渠道提醒', desc:'微信 / 短信 / 邮箱提醒（短信有通道成本）' },
  report_export: { name:'复诊报告导出', desc:'导出并分享给医生' },
  buddy:         { name:'同伴协同', desc:'让家人或朋友一起提醒你' },
  full_history:  { name:'完整历史趋势', desc:'解锁 30 天以上的心情与依从趋势' },
  unlimited:     { name:'不限药品数量', desc:'免费版最多 3 种' },
  csv:           { name:'打卡 CSV 导出', desc:'导出表格自行分析' }
};
var FREE_MED_LIMIT = 3;

function can(feat){
  return License.isPro() ? true : false;
}
function medLimit(){
  return License.isPro() ? 999 : FREE_MED_LIMIT;
}
function needPro(feat){
  var f = PRO_FEATURES[feat];
  toast((f ? f.name : '该功能') + ' 是会员功能，输入兑换码即可解锁');
  setTimeout(function(){ openLicenseSheet(); }, 600);
}

/* 兑换弹层 */
function openLicenseSheet(){
  var cur = License.isPro()
    ? '<div class="alert alert-pink" style="margin-bottom:14px">'+ico('sparkle','ico-sm')+
      '<div>当前：<b>'+esc(License.planName())+'</b> · '+esc(License.expiryText())+'</div></div>'
    : '<div class="alert alert-info" style="margin-bottom:14px">'+ico('info','ico-sm')+
      '<div>当前为<b>免费版</b>。基础的服药提醒与记录<b>永久免费</b>，会员解锁的是进阶能力。</div></div>';

  var list = Object.keys(PRO_FEATURES).map(function(k){
    var f = PRO_FEATURES[k];
    return '<div class="row"><div class="row-ico">'+ico('check','ico-sm')+'</div>'+
           '<div class="row-main"><div class="row-t">'+esc(f.name)+'</div>'+
           '<div class="row-d">'+esc(f.desc)+'</div></div></div>';
  }).join('');

  openModal('会员与兑换',
    cur +
    '<div class="field"><label>兑换码</label>' +
    '<input class="input" id="licCode" placeholder="XQ-P-XXXXXX-XXXXXX" autocomplete="off" autocapitalize="characters"></div>' +
    '<button class="btn btn-primary" id="licBtn">激活</button>' +
    '<div class="sec-title">会员包含</div>' +
    '<div class="card" style="box-shadow:none;padding:4px 14px">'+list+'</div>' +
    '<div class="sec-title">说明</div>' +
    '<p class="hint">兑换码激活只向服务器发送兑换码与设备标识，<b>不会上传任何服药或心情记录</b>。' +
    '未配置验证服务时完全离线校验，不产生任何网络请求。<br><br>' +
    '公益兑换码由合作的心理咨询机构、高校心理中心发放，可免费解锁全部功能。</p>' +
    (License.isPro() ? '<button class="btn btn-ghost btn-sm" id="licClear" style="margin-top:14px;width:100%">退出当前设备会员</button>' : '') +
    '<div style="height:8px"></div>',
    function(box){
      $('#licBtn').onclick = function(){
        var v = $('#licCode').value.trim();
        if(!v){ toast('请输入兑换码'); return; }
        $('#licBtn').textContent = '正在验证…';
        License.redeem(v, function(r){
          if(r.ok){
            closeModal();
            toast('已激活：' + PLAN_NAME[r.plan]);
            renderAll();
          }else{
            $('#licBtn').textContent = '激活';
            toast(r.reason || '兑换码无效');
          }
        });
      };
      if($('#licClear')) $('#licClear').onclick = function(){
        License.revoke(); closeModal(); toast('已退出会员'); renderAll();
      };
    });
}

/* ================================================================
 * 三、科普内容（合规措辞：解释与提醒，不作任何诊断或建议）
 * ================================================================ */
var KNOWLEDGE = [
  {
    id:'onset',
    icon:'sun',
    title:'为什么要等 2–4 周才见效',
    body:'<p>很多人在开始服药的头两周会怀疑"这药没用"——因为身体上的反应（恶心、嗜睡、头晕）先来了，而情绪的改善往往要<b>连续服用 2–4 周</b>后才慢慢显现。</p>'+
         '<p>这不是药没效，是它需要时间在体内建立稳定的浓度。这段时间是<b>最容易放弃的窗口期</b>，也是坚持下去回报最大的时候。</p>'+
         '<p class="hint" style="margin-top:8px">如果身体反应让你难以忍受，正确的做法不是自行停药，而是<b>记录下来，在复诊时告诉医生</b>——多数反应可以被处理。</p>'
  },
  {
    id:'stop',
    icon:'alert',
    title:'擅自停药可能会发生什么',
    body:'<ol>'+
         '<li><b>停药反应</b>：突然停药后 1–7 天内可能出现头晕、类似"电击"的异常感觉、失眠、烦躁、恶心、类似感冒的症状。半衰期较短的药物更明显。<b>通常 1–2 周内消退</b>，但会非常难受。</li>'+
         '<li><b>复发</b>：抑郁症首次发作后复发率约 <b>50%</b>，第二次约 <b>70%</b>，三次以上超过 <b>90%</b>。</li>'+
         '<li><b>治疗变难</b>：每复发一次，后续缓解需要的剂量可能更高、时间更长，一部分会转为难治性。</li>'+
         '<li><b>功能退化</b>：认知、社交、工作能力会随反复发作累积受损。</li>'+
         '<li><b>风险升高</b>：复发期与擅自停药期，是最需要身边人留意的阶段。</li>'+
         '</ol>'+
         '<p class="hint" style="margin-top:8px"><b>停药反应 ≠ 复发</b>。前者是身体在适应药物浓度下降，可逆；后者是疾病复燃。两者常被混淆，导致"以为好了就停、以为坏了就放弃"。</p>'
  },
  {
    id:'taper',
    icon:'leaf',
    title:'想停药，请先和医生商量',
    body:'<p>抗抑郁药<b>不建议骤停</b>。规范的做法是在医生指导下，用数周甚至数月的时间<b>逐步减量</b>，让身体慢慢适应。</p>'+
         '<p>本应用提供"减量计划"记录功能，帮你把医生给的减量安排记下来并按时执行——<b>它不会替你制定方案</b>，方案必须来自你的医生。</p>'+
         '<div class="alert alert-warn" style="margin-top:10px">'+ico('alert','ico-sm')+
         '<div>任何关于停药、减量、换药的决定，都必须由你的主治医生做出。</div></div>'
  },
  {
    id:'effect',
    icon:'flask',
    title:'身体反应怎么记才有用',
    body:'<p>复诊时医生最常问的三句话是"吃了多久""有没有不舒服""整体感觉怎么样"。但门诊时间有限，很多人当场想不起来。</p>'+
         '<p>有效的做法是<b>当天记</b>：哪一天、什么反应、持续多久、影响生活到什么程度。连续记录两到三周后，你就能看出规律——哪些反应在减轻，哪些需要干预。</p>'+
         '<p class="hint" style="margin-top:8px">本应用的记录只是"记"，不会对这些内容做任何判断或解读。</p>'
  },
  {
    id:'visit',
    icon:'steth',
    title:'让复诊更高效',
    body:'<p>精神科门诊往往只有几分钟。提前准备好一份结构化记录，能让医生在有限时间里掌握更准确的情况：</p>'+
         '<ul><li>这段时间<b>实际服药次数</b>与漏服情况</li>'+
         '<li><b>心情</b>的整体走向（不是某一天的好坏）</li>'+
         '<li><b>身体反应</b>集中在哪些、有没有减轻</li>'+
         '<li>想问医生的问题，<b>提前写下来</b></li></ul>'+
         '<p class="hint" style="margin-top:8px">用「报告」页生成记录，复制或分享给医生即可。</p>'
  }
];

/* ================================================================
 * 四、报告生成
 * ================================================================ */
function buildReport(){
  var days = 30;
  var a = adherence(days);
  var lines = [];
  lines.push('补药 · 用药与状态记录');
  lines.push('生成日期：' + today());
  lines.push('统计区间：最近 ' + days + ' 天');
  lines.push('────────────────');
  lines.push('');

  lines.push('【一、服药情况】');
  if(DB.meds.length === 0){
    lines.push('  暂无药品记录');
  }else{
    DB.meds.forEach(function(m){
      var t = timesOf(m).join('、');
      var sd = stockDays(m);
      lines.push('  · ' + m.name);
      lines.push('    规格：' + (m.spec || '未填写') + '　每次：' + (m.dose || '?') + (m.unit || ''));
      lines.push('    时间：' + t + '　库存：' + (m.stock || 0) + (m.unit || '') + (sd !== null ? ('（约 ' + sd + ' 天）') : ''));
      if(m.expiry) lines.push('    有效期至：' + m.expiry);
      if(m.risk && m.risk.length) lines.push('    标记：' + m.risk.join('、'));
    });
  }
  lines.push('');
  lines.push('  应服次数：' + a.expected + ' 次');
  lines.push('  实际记录：' + a.actual + ' 次');
  lines.push('  依从率：' + a.rate + '%');
  lines.push('  连续打卡：' + streak() + ' 天');
  lines.push('');

  lines.push('【二、心情记录】');
  var recent = DB.moods.filter(function(m){
    return dayDiff(m.date, today()) < days && dayDiff(m.date, today()) >= 0;
  }).sort(function(x,y){ return x.date < y.date ? -1 : 1; });
  if(recent.length === 0){
    lines.push('  暂无记录');
  }else{
    var sum = 0, dist = {1:0,2:0,3:0,4:0,5:0};
    recent.forEach(function(m){ sum += m.score; dist[m.score] = (dist[m.score]||0)+1; });
    lines.push('  记录天数：' + recent.length + ' 天');
    lines.push('  平均：' + (sum/recent.length).toFixed(1) + ' / 5');
    lines.push('  分布：' + [1,2,3,4,5].map(function(k){
      var mo = MOODS[k-1];
      return mo.label + ' ' + dist[k] + '天';
    }).join('　'));
  }
  lines.push('');

  lines.push('【三、身体反应】');
  var fx = {};
  recent.forEach(function(m){
    (m.effects||[]).forEach(function(e){ fx[e] = (fx[e]||0) + 1; });
  });
  var keys = Object.keys(fx).sort(function(a,b){ return fx[b]-fx[a]; });
  if(keys.length === 0){
    lines.push('  暂无记录');
  }else{
    keys.slice(0,10).forEach(function(k){ lines.push('  · ' + k + '　' + fx[k] + ' 次'); });
  }
  lines.push('');

  lines.push('【四、想说的话】');
  var notes = recent.filter(function(m){ return m.note && m.note.trim(); }).slice(-8);
  if(notes.length === 0) lines.push('  无');
  else notes.forEach(function(m){ lines.push('  ' + m.date + '：' + m.note.trim()); });
  lines.push('');
  lines.push('────────────────');
  lines.push('本记录由「补药」自动生成，内容均为本人自行填写。');
  lines.push('本应用仅作记录用途，不作任何评估、诊断或用药建议。');
  lines.push('如需帮助：全国心理援助热线 12356（24 小时 · 免费）');

  return lines.join('\n');
}

/* ================================================================
 * 五、图表（纯 SVG）
 * ================================================================ */
function svgLine(values, opt){
  opt = opt || {};
  var w = opt.w || 320, h = opt.h || 96, pad = 6;
  if(!values.length) return '<div class="hint">暂无数据</div>';
  var max = Math.max.apply(null, values.concat([opt.max || 0])) || 1;
  var min = opt.min != null ? opt.min : 0;
  var span = (max - min) || 1;
  var step = values.length > 1 ? (w - pad*2) / (values.length - 1) : 0;
  var pts = values.map(function(v,i){
    var x = pad + i*step;
    var y = h - pad - ((v - min) / span) * (h - pad*2);
    return [x, Math.max(pad, Math.min(h-pad, y))];
  });
  var d = pts.map(function(p,i){ return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
  var area = d + ' L' + pts[pts.length-1][0].toFixed(1) + ' ' + (h-pad) + ' L' + pts[0][0].toFixed(1) + ' ' + (h-pad) + ' Z';
  var dots = pts.map(function(p,i){
    return '<circle cx="'+p[0].toFixed(1)+'" cy="'+p[1].toFixed(1)+'" r="2.6" fill="'+
      (opt.color || 'var(--pink)') + '" opacity="' + (i === pts.length-1 ? 1 : .55) + '"/>';
  }).join('');
  return '<svg class="chart" viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none" style="height:'+h+'px">' +
    '<defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0%" stop-color="'+(opt.color||'var(--pink)')+'" stop-opacity=".28"/>' +
    '<stop offset="100%" stop-color="'+(opt.color||'var(--pink)')+'" stop-opacity="0"/></linearGradient></defs>' +
    '<path d="'+area+'" fill="url(#lg)"/>' +
    '<path d="'+d+'" fill="none" stroke="'+(opt.color||'var(--pink)')+'" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
    dots + '</svg>';
}

function svgBars(items, opt){
  opt = opt || {};
  if(!items.length) return '<div class="hint">暂无数据</div>';
  var w = 320, h = opt.h || 110, pad = 10;
  var bw = (w - pad*2) / items.length;
  var max = Math.max.apply(null, items.map(function(i){ return i.v; }).concat([1]));
  return '<svg class="chart" viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none" style="height:'+h+'px">' +
    items.map(function(it,i){
      var bh = Math.max(2, (it.v/max) * (h - 26));
      var x = pad + i*bw + bw*0.16;
      var bwid = bw*0.68;
      return '<rect x="'+x.toFixed(1)+'" y="'+(h-16-bh).toFixed(1)+'" width="'+bwid.toFixed(1)+
        '" height="'+bh.toFixed(1)+'" rx="3" fill="'+(it.c||'var(--pink)')+'" opacity="'+(it.v?'.9':'.2')+'"/>' +
        '<text x="'+(x+bwid/2).toFixed(1)+'" y="'+(h-4)+'" font-size="9" text-anchor="middle" fill="var(--gray)">'+esc(it.k)+'</text>';
    }).join('') + '</svg>';
}

function svgRing(pct, opt){
  opt = opt || {};
  var r = 26, c = 2*Math.PI*r;
  var off = c * (1 - clamp(pct,0,100)/100);
  return '<svg viewBox="0 0 62 62" width="62" height="62">' +
    '<circle cx="31" cy="31" r="'+r+'" fill="none" stroke="rgba(255,255,255,.3)" stroke-width="6"/>' +
    '<circle cx="31" cy="31" r="'+r+'" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" ' +
    'stroke-dasharray="'+c.toFixed(1)+'" stroke-dashoffset="'+off.toFixed(1)+'" transform="rotate(-90 31 31)"/>' +
    '<text x="31" y="35" font-size="15" font-weight="700" text-anchor="middle" fill="#fff">'+Math.round(pct)+'</text>' +
    '</svg>';
}
