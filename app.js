(function(){

  /* ---------------- Fixed roster ---------------- */
  const STUDENTS = [
    {name:"Андрієнко Артьом", tg:"coolchpl"},
    {name:"Болтушенко Олена", tg:"olenaboltushenko"},
    {name:"Власенко Євген", tg:"disharyaar"},
    {name:"Воропаєв Антон", tg:"koncwer"},
    {name:"Ганжа Дмитро", tg:"trrixsx"},
    {name:"Гордєєв Назар", tg:"ketoacidos"},
    {name:"Жуков Богдан", tg:"Bogdan_089"},
    {name:"Іпатій Андрій", tg:null},
    {name:"Литвинець Ірина", tg:"lirenaa"},
    {name:"Лобунець Данііл", tg:"siwxy38g"},
    {name:"Ляшко Ірина", tg:"Irina_Your_Nail_Master"},
    {name:"Назаров Михайло", tg:"SwetiTeam"},
    {name:"Олійник Ангеліна", tg:"Luinn_a"},
    {name:"Павловський Марк", tg:null},
    {name:"Печенюк Дмитро", tg:"Strann11kk"},
    {name:"Потапов Георгій", tg:"hollowqiu"},
    {name:"Сердюк Яна", tg:"Yanaffffer"},
    {name:"Ткаченко Давид", tg:"David424200"},
    {name:"Ульянов Максим", tg:"max_ulianov09"},
    {name:"Хижняков Микола", tg:null},
    {name:"Шаповалов Нікіта", tg:"whdyxi"},
    {name:"Шевченко Олександр", tg:"Archion16"},
    {name:"Шкаровський Максим", tg:"maks_shkar"}
  ];

  /* ---------------- State ---------------- */
  let weeksIndex = [];        // [{key,label,mondayISO,closed}] — derived from Firebase snapshot
  let weekCache = {};         // key -> {label, lectures, attendance, closed}
  let currentWeekKey = null;
  let currentView = 'week';   // 'week' | 'summary'
  let summaryData = null;     // computed lazily

  const mainEl = document.getElementById('main');
  const toolbarEl = document.getElementById('toolbarInner');
  const fileInput = document.getElementById('fileInput');
  const mastheadActionsEl = document.getElementById('mastheadActions');

  /* ---------------- Firebase config ----------------
     Журнал синхронізується через Firebase Realtime Database — так відмітки,
     зроблені з телефону чи з комп'ютера, з'являються одночасно на всіх
     пристроях. Щоб увімкнути це:

     1. Зайди на https://console.firebase.google.com і створи проєкт (безкоштовно).
     2. Зліва: Build → Realtime Database → Create Database (регіон і режим
        не важливі — правила нижче все одно перепишуть доступ).
     3. Зліва: Build → Authentication → вкладка Sign-in method → увімкни
        "Email/Password".
     4. Там же, вкладка Users → Add user → введи свій email і пароль.
        Це буде єдиний акаунт для входу в журнал (можна додати ще людей так само).
     5. Тиснемо на шестерню зверху → Project settings → внизу розділу
        "Your apps" тисни "</>" (Web) → зареєструй застосунок → скопіюй
        об'єкт firebaseConfig, який покажуть, і встав його нижче замість
        значень-заглушок.
     6. Realtime Database → вкладка Rules → встав:
          {
            "rules": {
              "journal_pi267": {
                ".read": "auth != null",
                ".write": "auth != null"
              }
            }
          }
        і натисни Publish. Це закриває дані від сторонніх — читати й писати
        може лише той, хто увійшов через акаунт з кроку 4.
  */
  const firebaseConfig = {
    apiKey: "AIzaSyAqj1dBvByK6Vwnz0nEaHyHVyKY8h1pIvU",
    authDomain: "pi26-7.firebaseapp.com",
    databaseURL: "https://pi26-7-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "pi26-7",
    storageBucket: "pi26-7.firebasestorage.app",
    messagingSenderId: "788681929939",
    appId: "1:788681929939:web:14eab5dadaed91d4cb9026"
  };
  const DB_PATH = 'journal_pi267';

  function configIsFilled(){
    return !!firebaseConfig.apiKey && firebaseConfig.apiKey.indexOf('ВСТАВ_СЮДИ') === -1;
  }

  let auth = null;
  let db = null;
  let weeksRef = null;
  let weeksListener = null;

  /* ---------------- Attendance key helper ----------------
     Firebase Realtime Database silently turns an object whose keys look
     like sequential array indices ("0","1","2"...) into an actual array.
     Student indexes are exactly that, so every attendance key gets an "s"
     prefix to keep it a normal object on both write and read. */
  function skey(idx){ return 's' + idx; }

  /* ---------------- Sync layer (Firebase Realtime Database) ---------------- */
  function sortedWeeksAsc(){
    return weeksIndex.slice().sort((a,b)=> a.mondayISO < b.mondayISO ? -1 : 1);
  }

  function loadWeek(key){
    return weekCache[key] || null;
  }

  function saveWeek(key, data){
    weekCache[key] = data; // optimistic local update; the listener confirms it moments later
    if(!db) return;
    db.ref(DB_PATH + '/' + key).set(data).catch(err=>{
      showToast('Не вдалося зберегти: ' + err.message);
    });
  }

  function deleteWeekRemote(key){
    delete weekCache[key];
    if(!db) return;
    db.ref(DB_PATH + '/' + key).remove().catch(err=>{
      showToast('Не вдалося видалити: ' + err.message);
    });
  }

  function setWeekClosed(key, closed){
    const week = loadWeek(key);
    if(!week) return;
    week.closed = closed;
    saveWeek(key, week);
    const idxEntry = weeksIndex.find(w=>w.key===key);
    if(idxEntry) idxEntry.closed = closed;
  }

  function startSync(){
    if(weeksListener) return;
    weeksRef = db.ref(DB_PATH);
    weeksListener = weeksRef.on('value', snapshot=>{
      const weeksObj = snapshot.val() || {};
      weekCache = {};
      weeksIndex = Object.keys(weeksObj).map(key=>{
        const w = weeksObj[key];
        weekCache[key] = w;
        return { key, label: w.label, mondayISO: w.mondayISO, closed: !!w.closed };
      });
      weeksIndex.sort((a,b)=> a.mondayISO < b.mondayISO ? 1 : -1); // newest first
      summaryData = null;
      renderAll();
    }, err=>{
      showToast('Помилка синхронізації: ' + err.message);
    });
  }

  function stopSync(){
    if(weeksRef && weeksListener){ weeksRef.off('value', weeksListener); }
    weeksRef = null;
    weeksListener = null;
    weeksIndex = [];
    weekCache = {};
    currentWeekKey = null;
  }

  /* ---------------- Auth ---------------- */
  function renderSetupNeeded(){
    toolbarEl.innerHTML = '';
    mainEl.innerHTML = `
      <div class="login-box">
        <h2>Синхронізацію ще не налаштовано</h2>
        <p>У файлі app.js потрібно вписати дані свого Firebase-проєкту (об'єкт firebaseConfig на початку файлу) — короткі кроки описані прямо там у коментарі. Це займає кілька хвилин і робиться один раз.</p>
      </div>`;
  }

  function renderLogin(errorMsg){
    toolbarEl.innerHTML = '';
    if(mastheadActionsEl) mastheadActionsEl.innerHTML = '';
    mainEl.innerHTML = `
      <div class="login-box">
        <h2>Вхід у журнал</h2>
        <p>Дані синхронізуються між усіма пристроями. Увійди акаунтом, який ти створив у Firebase.</p>
        ${errorMsg ? `<div class="login-error">${escapeHtml(errorMsg)}</div>` : ''}
        <input type="email" id="loginEmail" placeholder="Email" autocomplete="username">
        <input type="password" id="loginPass" placeholder="Пароль" autocomplete="current-password">
        <button class="btn-primary" id="loginBtn" style="width:100%;">Увійти</button>
      </div>`;
    const doLogin = ()=>{
      const email = document.getElementById('loginEmail').value.trim();
      const pass = document.getElementById('loginPass').value;
      if(!email || !pass) return;
      auth.signInWithEmailAndPassword(email, pass).catch(err=> renderLogin(translateAuthError(err)));
    };
    document.getElementById('loginBtn').addEventListener('click', doLogin);
    document.getElementById('loginPass').addEventListener('keydown', e=>{ if(e.key==='Enter') doLogin(); });
  }

  function translateAuthError(err){
    const map = {
      'auth/invalid-email': 'Некоректний email.',
      'auth/user-not-found': 'Такого користувача немає.',
      'auth/wrong-password': 'Невірний пароль.',
      'auth/invalid-credential': 'Невірний email або пароль.',
      'auth/too-many-requests': 'Забагато спроб. Спробуй трохи пізніше.'
    };
    return map[err.code] || ('Помилка входу: ' + err.message);
  }

  function renderSignedInBadge(){
    if(!mastheadActionsEl) return;
    const email = auth.currentUser ? auth.currentUser.email : '';
    mastheadActionsEl.innerHTML = `
      <span class="signed-in-as">${escapeHtml(email)}</span>
      <button class="ghost-btn" id="signOutBtn">вийти</button>`;
    document.getElementById('signOutBtn').addEventListener('click', ()=> auth.signOut());
  }

  /* ---------------- Schedule file parsing ---------------- */
  function decodeFile(arrayBuffer){
    try{
      return new TextDecoder('windows-1251').decode(arrayBuffer);
    }catch(e){
      return new TextDecoder('utf-8').decode(arrayBuffer);
    }
  }

  function cellTexts(row, ns){
    const cells = Array.from(row.getElementsByTagNameNS(ns, 'Cell'));
    return cells.map(c=>{
      const data = c.getElementsByTagNameNS(ns, 'Data')[0];
      return data ? (data.textContent || '').trim() : '';
    });
  }

  function parseSchedule(xmlText){
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'text/xml');
    const perr = doc.getElementsByTagName('parsererror');
    if(perr.length){ throw new Error('Не вдалося розпізнати файл як XML-таблицю Excel.'); }
    const ns = 'urn:schemas-microsoft-com:office:spreadsheet';
    const rows = Array.from(doc.getElementsByTagNameNS(ns, 'Row'));
    if(!rows.length){ throw new Error('У файлі не знайдено рядків таблиці.'); }

    const dateRe = /^(\d{2})\.(\d{2})\.(\d{4})$/;
    const legend = {};
    const dayBlocks = [];
    let current = null;

    rows.forEach(row=>{
      const vals = cellTexts(row, ns);
      const nonEmpty = vals.filter(v=>v !== '');

      // day header: exactly 2 non-empty cells, second looks like a date, first is a plain
      // day label (not a signature line, which always contains an underscore rule)
      if(nonEmpty.length === 2 && dateRe.test(nonEmpty[1]) && nonEmpty[0].indexOf('_') === -1){
        current = { dayLabel: nonEmpty[0], dateRaw: nonEmpty[1], lectures: [] };
        dayBlocks.push(current);
        return;
      }
      // class row: >=3 cells, first is a small integer (pair #), second has a time-like pattern
      if(vals.length >= 3 && /^\d{1,2}$/.test(vals[0]) && /\d{1,2}:\d{2}/.test(vals[1]) && vals[2] !== '' && current){
        current.lectures.push({ pair: vals[0], time: vals[1], subjectRaw: vals[2] });
        return;
      }
      // legend row: 3 cells, first empty, second short code, third contains ' : '
      if(vals.length >= 3 && vals[0] === '' && vals[1] !== '' && vals[1].length <= 12 && vals[2].indexOf(' : ') !== -1){
        legend[vals[1]] = vals[2].split(' : ')[0].trim();
      }
    });

    if(!dayBlocks.length){ throw new Error('Не знайдено жодного дня розкладу у файлі.'); }

    function toISO(raw){
      const m = dateRe.exec(raw);
      return m ? (m[3] + '-' + m[2] + '-' + m[1]) : raw;
    }

    const lectures = [];
    dayBlocks.forEach(block=>{
      const dateISO = toISO(block.dateRaw);
      block.lectures.forEach(l=>{
        const tokens = l.subjectRaw.split(/\s+/).filter(Boolean);
        const code = tokens[0] || l.subjectRaw;
        const type = tokens[1] || '';
        const location = tokens.slice(2).join(' ');
        lectures.push({
          id: dateISO + '_' + l.pair,
          dateISO, dateRaw: block.dateRaw, dayLabel: block.dayLabel,
          pair: l.pair, time: l.time,
          code, type, location,
          fullName: legend[code] || code
        });
      });
    });

    if(!lectures.length){ throw new Error('У цьому тижні розкладу немає жодної пари (можливо, файл охоплює лише вихідні).'); }

    lectures.sort((a,b)=> (a.dateISO+a.pair.padStart(2,'0')) < (b.dateISO+b.pair.padStart(2,'0')) ? -1 : 1);

    // use the full calendar week (all day-header rows found), not just days that
    // happen to have lectures, so the week's identity stays stable
    const mondayISO = toISO(dayBlocks[0].dateRaw);
    const lastISO = toISO(dayBlocks[dayBlocks.length-1].dateRaw);

    function fmt(iso){ const [y,m,d]=iso.split('-'); return d+'.'+m; }
    const label = fmt(mondayISO) + '–' + fmt(lastISO) + '.' + mondayISO.slice(0,4);

    return { key: mondayISO, label, mondayISO, lectures };
  }

  /* ---------------- Attendance logic ---------------- */
  function nextState(s){ return (s+1) % 3; } // 0 unmarked -> 1 present -> 2 absent -> 0

  function setMark(weekKey, lectureId, studentIdx, state){
    const week = loadWeek(weekKey);
    if(!week.attendance) week.attendance = {};
    if(!week.attendance[lectureId]) week.attendance[lectureId] = {};
    if(state === 0){ delete week.attendance[lectureId][skey(studentIdx)]; }
    else{ week.attendance[lectureId][skey(studentIdx)] = state; }
    saveWeek(weekKey, week);
    summaryData = null;
  }

  function markAllPresent(weekKey, lectureId){
    const week = loadWeek(weekKey);
    if(!week.attendance) week.attendance = {};
    const m = {};
    STUDENTS.forEach((s,i)=> m[skey(i)] = 1);
    week.attendance[lectureId] = m;
    saveWeek(weekKey, week);
    summaryData = null;
  }

  /* ---------------- Rendering: toolbar ---------------- */
  function renderToolbar(){
    let html = '';
    weeksIndex.forEach(w=>{
      const active = (currentView==='week' && w.key===currentWeekKey) ? ' active' : '';
      const lock = w.closed ? '<span class="tab-lock" title="Тиждень завершено">🔒</span>' : '';
      html += `<button class="tab-btn${active}" data-week="${w.key}">${w.label}${lock}</button>`;
    });
    html += `<div class="tab-sep"></div>`;
    html += `<button class="tab-btn${currentView==='summary'?' active':''}" data-view="summary">Зведення</button>`;
    html += `<button class="upload-btn" id="uploadBtn">+ Завантажити тиждень</button>`;
    if(weeksIndex.length){
      html += `<button class="upload-btn" id="exportBtn" style="background:#2E4B3A;border-color:#3D6B52;">Експорт в Excel</button>`;
    }
    toolbarEl.innerHTML = html;

    toolbarEl.querySelectorAll('[data-week]').forEach(btn=>{
      btn.addEventListener('click', ()=>{ currentView='week'; currentWeekKey = btn.dataset.week; renderAll(); });
    });
    toolbarEl.querySelector('[data-view="summary"]').addEventListener('click', ()=>{ currentView='summary'; renderAll(); });
    document.getElementById('uploadBtn').addEventListener('click', ()=> fileInput.click());
    const exportBtn = document.getElementById('exportBtn');
    if(exportBtn) exportBtn.addEventListener('click', showExportModal);
  }

  /* ---------------- Rendering: empty state ---------------- */
  function renderEmpty(){
    mainEl.innerHTML = `
      <div class="empty-state">
        <h2>Журнал поки порожній</h2>
        <p>Завантаж Excel-файл розкладу на тиждень (той, що видає деканат) — журнал сам розбере дні, пари та предмети і додасть колонки для відміток.</p>
        <button class="upload-btn" id="uploadBtn2" style="margin:0;">+ Завантажити перший тиждень</button>
      </div>`;
    document.getElementById('uploadBtn2').addEventListener('click', ()=> fileInput.click());
  }

  /* ---------------- Rendering: week view ---------------- */
  function renderWeek(){
    const week = loadWeek(currentWeekKey);
    if(!week){ renderEmpty(); return; }

    const days = [];
    week.lectures.forEach(l=>{
      let d = days.find(x=>x.dateISO===l.dateISO);
      if(!d){ d = {dateISO:l.dateISO, dateRaw:l.dateRaw, dayLabel:l.dayLabel, lectures:[]}; days.push(d); }
      d.lectures.push(l);
    });

    const attendance = week.attendance || {};
    const locked = !!week.closed;

    const ascArr = sortedWeeksAsc();
    const posIdx = ascArr.findIndex(w=>w.key===currentWeekKey);
    const hasPrev = posIdx > 0;
    const hasNext = posIdx >= 0 && posIdx < ascArr.length - 1;

    let dayHeadHtml = '';
    days.forEach(d=>{
      dayHeadHtml += `<th class="day-head" colspan="${d.lectures.length}">${d.dayLabel}<span class="d-date">${d.dateRaw}</span></th>`;
    });

    let pairHeadHtml = '';
    week.lectures.forEach(l=>{
      const title = l.fullName + (l.location ? (' · ' + l.location) : '');
      pairHeadHtml += `<th class="pair-head" title="${escapeAttr(title)}">
          <span class="pair-num">${l.pair} пара</span>
          <span class="pair-time">${l.time}</span>
          <span class="pair-subj">${escapeHtml(l.code)} <span class="pair-type">${escapeHtml(l.type)}</span></span>
          <button class="mark-all" data-lecture="${l.id}">усі присутні</button>
        </th>`;
    });

    let bodyHtml = '';
    STUDENTS.forEach((stu, idx)=>{
      let rowAbs = 0;
      let cellsHtml = '';
      week.lectures.forEach(l=>{
        const st = (attendance[l.id] && attendance[l.id][skey(idx)]) || 0;
        if(st===2) rowAbs++;
        cellsHtml += `<td class="cell-attend${locked?' locked':''}" data-lecture="${l.id}" data-student="${idx}"><div class="mark state-${st}"></div></td>`;
      });
      const tgLink = stu.tg ? `<a href="https://t.me/${stu.tg}" target="_blank" rel="noopener">${escapeHtml(stu.name)}</a>` : escapeHtml(stu.name);
      bodyHtml += `<tr>
        <td class="col-student"><span class="student-name">${tgLink}<span class="row-absences${rowAbs?' has-abs':''}">${rowAbs? 'н·'+rowAbs : ''}</span></span></td>
        ${cellsHtml}
      </tr>`;
    });

    let footHtml = '<td class="col-student">присутні / всього</td>';
    week.lectures.forEach(l=>{
      let present=0;
      STUDENTS.forEach((_,idx)=>{
        const st = (attendance[l.id] && attendance[l.id][skey(idx)]) || 0;
        if(st===1) present++;
      });
      footHtml += `<td>${present}/${STUDENTS.length}</td>`;
    });

    mainEl.innerHTML = `
      <div class="week-meta">
        <div>
          <h2>Тиждень ${escapeHtml(week.label)}${locked?' <span class="lock-tag">завершено</span>':''}</h2>
          <div class="count">${week.lectures.length} пар · ${days.length} днів</div>
        </div>
        <div class="week-actions">
          <button class="ghost-btn" id="prevWeekBtn" ${hasPrev?'':'disabled'}>← попередній</button>
          <button class="ghost-btn" id="nextWeekBtn" ${hasNext?'':'disabled'}>наступний →</button>
          <button class="ghost-btn" id="toggleCloseBtn">${locked?'активувати тиждень':'завершити тиждень'}</button>
          <button class="ghost-btn danger" id="deleteWeekBtn">видалити тиждень</button>
        </div>
      </div>
      ${locked?'<div class="week-closed-banner">🔒 Тиждень завершено — відмітки заблоковано від редагування. Натисни «активувати тиждень», щоб знову їх редагувати.</div>':''}
      <div class="table-scroll">
        <table class="journal">
          <thead>
            <tr><th class="col-student"></th>${dayHeadHtml}</tr>
            <tr><th class="col-student" style="background:#F1F3F6;"></th>${pairHeadHtml}</tr>
          </thead>
          <tbody>${bodyHtml}</tbody>
          <tfoot><tr>${footHtml}</tr></tfoot>
        </table>
      </div>
      <div class="legend">
        <span><i class="u"></i> не відмічено</span>
        <span><i class="p"></i> присутній</span>
        <span><i class="a"></i> відсутній</span>
        <span>Клік по клітинці перемикає стан. Кнопка над парою — «усі присутні».</span>
      </div>
    `;

    mainEl.querySelectorAll('td.cell-attend').forEach(td=>{
      td.addEventListener('click', ()=>{
        if(locked){ showToast('Тиждень завершено — редагування вимкнено'); return; }
        const lectureId = td.dataset.lecture;
        const studentIdx = parseInt(td.dataset.student, 10);
        const markDiv = td.querySelector('.mark');
        const cur = parseInt((markDiv.className.match(/state-(\d)/)||[0,0])[1], 10);
        const next = nextState(cur);
        setMark(currentWeekKey, lectureId, studentIdx, next);
        renderWeek();
      });
    });

    mainEl.querySelectorAll('.mark-all').forEach(btn=>{
      btn.addEventListener('click', (e)=>{
        e.stopPropagation();
        if(locked){ showToast('Тиждень завершено — редагування вимкнено'); return; }
        markAllPresent(currentWeekKey, btn.dataset.lecture);
        renderWeek();
      });
    });

    const prevBtn = document.getElementById('prevWeekBtn');
    if(hasPrev) prevBtn.addEventListener('click', ()=>{
      currentWeekKey = ascArr[posIdx-1].key;
      currentView = 'week';
      renderAll();
    });

    const nextBtn = document.getElementById('nextWeekBtn');
    if(hasNext) nextBtn.addEventListener('click', ()=>{
      currentWeekKey = ascArr[posIdx+1].key;
      currentView = 'week';
      renderAll();
    });

    document.getElementById('toggleCloseBtn').addEventListener('click', ()=>{
      if(locked){
        setWeekClosed(currentWeekKey, false);
        showToast('Тиждень знову активний');
        renderAll();
      } else {
        showModal({
          title: 'Завершити тиждень?',
          text: `Тиждень ${week.label} буде позначено завершеним, редагування відміток вимкнеться. Його завжди можна активувати знову.`,
          confirmLabel: 'Завершити',
          onConfirm: ()=>{
            setWeekClosed(currentWeekKey, true);
            showToast('Тиждень завершено');
            renderAll();
          }
        });
      }
    });

    document.getElementById('deleteWeekBtn').addEventListener('click', ()=>{
      showModal({
        title: 'Видалити тиждень?',
        text: `Тиждень ${week.label} та всі відмітки в ньому буде видалено безповоротно на всіх пристроях.`,
        confirmLabel: 'Видалити', danger:true,
        onConfirm: ()=>{
          deleteWeekRemote(currentWeekKey);
          weeksIndex = weeksIndex.filter(w=>w.key!==currentWeekKey);
          currentWeekKey = weeksIndex.length ? weeksIndex[0].key : null;
          renderAll();
        }
      });
    });
  }

  /* ---------------- Rendering: summary view ---------------- */
  function computeSummary(weekKeys){
    const keys = weekKeys || weeksIndex.map(w=>w.key);
    const rows = STUDENTS.map(s=>({ name:s.name, tg:s.tg, absences:0, present:0, totalLectures:0 }));
    keys.forEach(key=>{
      const week = loadWeek(key);
      if(!week) return;
      const att = week.attendance || {};
      week.lectures.forEach(l=>{
        STUDENTS.forEach((_,idx)=>{
          rows[idx].totalLectures++;
          const st = (att[l.id] && att[l.id][skey(idx)]) || 0;
          if(st===2) rows[idx].absences++;
          else if(st===1) rows[idx].present++;
        });
      });
    });
    return rows;
  }

  function renderSummary(){
    if(!weeksIndex.length){ renderEmpty(); return; }
    const rowsBase = computeSummary();
    summaryData = rowsBase.slice().sort((a,b)=> b.absences - a.absences);
    const maxAbs = Math.max(1, ...summaryData.map(r=>r.absences));

    let rowsHtml = '';
    summaryData.forEach(r=>{
      const pct = Math.round((r.absences / maxAbs) * 100);
      const nameHtml = r.tg ? `<a href="https://t.me/${r.tg}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none;border-bottom:1px dotted var(--line);">${escapeHtml(r.name)}</a>` : escapeHtml(r.name);
      rowsHtml += `<tr>
        <td>${nameHtml}</td>
        <td class="num">${r.totalLectures}</td>
        <td class="num">${r.present}</td>
        <td class="num">${r.absences}</td>
        <td><div class="bar-cell"><div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div></div></td>
      </tr>`;
    });

    mainEl.innerHTML = `
      <div class="week-meta">
        <div>
          <h2>Зведення за весь семестр</h2>
          <div class="count">${weeksIndex.length} завантажених тижнів</div>
        </div>
      </div>
      <table class="summary-table">
        <thead><tr><th>Студент</th><th>Пар всього</th><th>Присутній</th><th>Відсутній</th><th>Частка пропусків</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    `;
  }

  /* ---------------- Excel export (classic journal, for the deanery) ---------------- */
  function safeSheetName(name){
    // Excel sheet names: max 31 chars, no : \ / ? * [ ]
    return name.replace(/[:\\\/\?\*\[\]]/g, '-').slice(0, 31);
  }

  function buildWeekAOA(week){
    const days = [];
    week.lectures.forEach(l=>{
      let d = days.find(x=>x.dateISO===l.dateISO);
      if(!d){ d = {dateISO:l.dateISO, dateRaw:l.dateRaw, dayLabel:l.dayLabel, lectures:[]}; days.push(d); }
      d.lectures.push(l);
    });

    const headRow1 = ['№', 'ПІБ'];
    const headRow2 = ['', ''];
    days.forEach(d=>{
      headRow1.push(d.dayLabel + ' ' + d.dateRaw);
      for(let i=1; i<d.lectures.length; i++) headRow1.push('');
      d.lectures.forEach(l=>{
        headRow2.push(l.pair + ' пара, ' + l.time + ' — ' + l.code + (l.type? (' ('+l.type+')') : ''));
      });
    });
    headRow1.push('Пропусків');
    headRow2.push('');

    const attendance = week.attendance || {};
    const dataRows = STUDENTS.map((stu, idx)=>{
      let abs = 0;
      const marks = week.lectures.map(l=>{
        const st = (attendance[l.id] && attendance[l.id][skey(idx)]) || 0;
        if(st===2){ abs++; return 'н'; }
        return '';
      });
      return [idx+1, stu.name, ...marks, abs];
    });

    const legendRow = ['', 'н — відсутній, порожня клітинка — присутній або відмітка не проставлена'];

    const aoa = [headRow1, headRow2, ...dataRows, [], legendRow];

    // merge day-header cells across their pair columns (row 0, 0-indexed cols starting at 2)
    const merges = [];
    let col = 2;
    days.forEach(d=>{
      if(d.lectures.length > 1){
        merges.push({ s:{r:0, c:col}, e:{r:0, c: col + d.lectures.length - 1} });
      }
      col += d.lectures.length;
    });

    return { aoa, merges };
  }

  function buildSummaryAOA(weekKeys){
    const rows = computeSummary(weekKeys); // already in roster order
    const aoa = [
      ['Зведення відвідуваності — група ПІ-26-7'],
      [],
      ['№', 'ПІБ', 'Пар всього', 'Присутній', 'Відсутній']
    ];
    rows.forEach((r, idx)=>{
      aoa.push([idx+1, r.name, r.totalLectures, r.present, r.absences]);
    });
    return aoa;
  }

  function showExportModal(){
    if(!weeksIndex.length) return;
    const arr = sortedWeeksAsc();
    const itemsHtml = arr.map(w=>`
        <label class="export-week-row">
          <input type="checkbox" class="export-week-chk" value="${w.key}" checked>
          <span>${escapeHtml(w.label)}${w.closed?' <span class="lock-tag">завершено</span>':''}</span>
        </label>`).join('');

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal modal-wide">
        <h3>Експорт в Excel</h3>
        <p>Обери тижні, за які скласти файл для деканату. Зведення на першому аркуші порахується лише за обрані тижні.</p>
        <div class="export-week-actions">
          <button class="ghost-btn" id="expSelAll">обрати всі</button>
          <button class="ghost-btn" id="expSelNone">зняти всі</button>
        </div>
        <div class="export-week-list">${itemsHtml}</div>
        <div class="modal-actions">
          <button class="ghost-btn" id="modalCancel">Скасувати</button>
          <button class="btn-primary" id="expConfirm">Експортувати</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);

    backdrop.querySelector('#modalCancel').addEventListener('click', ()=> backdrop.remove());
    backdrop.addEventListener('click', (e)=>{ if(e.target===backdrop) backdrop.remove(); });
    backdrop.querySelector('#expSelAll').addEventListener('click', ()=>{
      backdrop.querySelectorAll('.export-week-chk').forEach(c=> c.checked = true);
    });
    backdrop.querySelector('#expSelNone').addEventListener('click', ()=>{
      backdrop.querySelectorAll('.export-week-chk').forEach(c=> c.checked = false);
    });
    backdrop.querySelector('#expConfirm').addEventListener('click', ()=>{
      const keys = Array.from(backdrop.querySelectorAll('.export-week-chk:checked')).map(c=>c.value);
      backdrop.remove();
      if(!keys.length){ showToast('Не обрано жодного тижня для експорту'); return; }
      exportWorkbook(keys);
    });
  }

  function exportWorkbook(weekKeys){
    if(typeof XLSX === 'undefined'){
      showModal({ title:'Немає з’єднання', text:'Не вдалося завантажити бібліотеку для Excel (XLSX). Перевір інтернет-з’єднання і спробуй ще раз.', confirmLabel:'Зрозуміло', onConfirm:()=>{} });
      return;
    }
    const keys = weekKeys && weekKeys.length ? weekKeys : weeksIndex.map(w=>w.key);
    const keySet = new Set(keys);
    const selectedIndex = weeksIndex.filter(w=> keySet.has(w.key));

    // make sure every selected week is in cache
    selectedIndex.forEach(w=> loadWeek(w.key));

    const wb = XLSX.utils.book_new();

    const wsSummary = XLSX.utils.aoa_to_sheet(buildSummaryAOA(keys));
    wsSummary['!cols'] = [{wch:4},{wch:26},{wch:12},{wch:12},{wch:12}];
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Зведення');

    selectedIndex.slice().sort((a,b)=> a.mondayISO < b.mondayISO ? -1 : 1).forEach(w=>{
      const week = weekCache[w.key];
      if(!week) return;
      const {aoa, merges} = buildWeekAOA(week);
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!merges'] = merges;
      const colWidths = [{wch:4},{wch:26}];
      week.lectures.forEach(()=> colWidths.push({wch:11}));
      colWidths.push({wch:10});
      ws['!cols'] = colWidths;
      XLSX.utils.book_append_sheet(wb, ws, safeSheetName(w.label));
    });

    XLSX.writeFile(wb, 'Журнал_ПІ-26-7.xlsx');
  }

  /* ---------------- Modal + toast ---------------- */
  function showModal({title, text, confirmLabel, danger, onConfirm}){
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal">
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(text)}</p>
        <div class="modal-actions">
          <button class="ghost-btn" id="modalCancel">Скасувати</button>
          <button class="btn-primary${danger?' danger':''}" id="modalConfirm">${escapeHtml(confirmLabel)}</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);
    backdrop.querySelector('#modalCancel').addEventListener('click', ()=> backdrop.remove());
    backdrop.addEventListener('click', (e)=>{ if(e.target===backdrop) backdrop.remove(); });
    backdrop.querySelector('#modalConfirm').addEventListener('click', ()=>{ backdrop.remove(); onConfirm(); });
  }

  function showToast(msg){
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(()=> t.remove(), 3200);
  }

  /* ---------------- Utils ---------------- */
  function escapeHtml(str){
    return String(str).replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }
  function escapeAttr(str){ return escapeHtml(str); }

  /* ---------------- File upload flow ---------------- */
  fileInput.addEventListener('change', async (e)=>{
    const file = e.target.files[0];
    fileInput.value = '';
    if(!file) return;
    try{
      const buf = await file.arrayBuffer();
      const text = decodeFile(buf);
      const parsed = parseSchedule(text);
      const existing = weeksIndex.find(w=>w.key===parsed.key);
      if(existing){
        showModal({
          title: 'Тиждень уже є в журналі',
          text: `Тиждень ${parsed.label} вже завантажено. Замінити розклад? Відмітки присутності для пар з тими самими датою й номером пари збережуться, для нових/змінених пар — почнуться заново.`,
          confirmLabel: 'Замінити',
          onConfirm: ()=> commitWeek(parsed, true)
        });
      } else {
        commitWeek(parsed, false);
      }
    }catch(err){
      showModal({ title:'Не вдалося розпізнати файл', text: err.message || String(err), confirmLabel:'Зрозуміло', onConfirm:()=>{} });
    }
  });

  function commitWeek(parsed, isReplace){
    let attendance = {};
    let closed = false;
    if(isReplace){
      const old = loadWeek(parsed.key);
      if(old){
        if(old.attendance) attendance = old.attendance; // keyed by "date_pair", so unchanged pairs keep their marks
        closed = !!old.closed;
      }
    }
    const weekData = { label: parsed.label, mondayISO: parsed.mondayISO, lectures: parsed.lectures, attendance, closed };
    saveWeek(parsed.key, weekData);
    const existingEntry = weeksIndex.find(w=>w.key===parsed.key);
    if(!existingEntry){
      weeksIndex.push({ key: parsed.key, label: parsed.label, mondayISO: parsed.mondayISO, closed });
    } else {
      existingEntry.label = parsed.label;
      existingEntry.closed = closed;
    }
    summaryData = null;
    currentView = 'week';
    currentWeekKey = parsed.key;
    showToast(isReplace ? 'Тиждень оновлено' : 'Тиждень додано до журналу');
    renderAll();
  }

  /* ---------------- Master render ---------------- */
  function renderAll(){
    renderToolbar();
    if(!weeksIndex.length){ renderEmpty(); return; }
    if(currentView==='summary'){ renderSummary(); }
    else{
      if(!currentWeekKey || !weeksIndex.find(w=>w.key===currentWeekKey)) currentWeekKey = weeksIndex[0].key;
      renderWeek();
    }
    renderToolbar();
  }

  /* ---------------- Init ---------------- */
  if(!configIsFilled()){
    renderSetupNeeded();
  } else {
    firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    db = firebase.database();

    auth.onAuthStateChanged(user=>{
      if(user){
        renderSignedInBadge();
        startSync();
      } else {
        stopSync();
        renderLogin();
      }
    });
  }

})();
