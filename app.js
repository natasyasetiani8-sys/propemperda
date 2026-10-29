(() => {
  'use strict';

  const STAGES = ['Perencanaan', 'Penyusunan', 'Pembahasan', 'Persetujuan Bersama', 'Penetapan dan Pengundangan'];
  const INITIATORS = ['Pemerintah Daerah', 'DPRD'];
  const INITIATOR_COLORS = ['#0f4c81', '#f0c96b'];

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = (u) => (/^(https?:\/\/|\/uploads\/)/i.test(u) ? u : '#');
  const dateFmt = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const fmtDate = (iso) => (iso ? dateFmt.format(new Date(`${iso}T00:00:00Z`)) : '');
  const byDate = (a, b) => (a.date || '').localeCompare(b.date || '');

  let DATA = { years: [], propemperda: [], ranperda: [], survey: [], visits: 0 };
  let chartYear = null;
  let detailYear = null;
  let chartPengusul = null;
  let chartStatus = null;

  // ---------- Navigasi ----------
  const pages = $$('.page');
  const pageLinks = $$('[data-page-link]');
  const mainNav = $('.main-nav');
  const navToggle = $('.nav-toggle');

  function showPage(id) {
    const m = /^Informasi(\d{4})$/.exec(id);
    let pageId = id;
    let navId = id;
    if (m) {
      pageId = 'informasi-detail';
      navId = 'informasi';
      detailYear = Number(m[1]);
      renderDetail();
    }
    const target = document.getElementById(pageId);
    if (!target || !target.classList.contains('page')) { pageId = 'beranda'; navId = 'beranda'; }
    const visible = pageId === 'beranda' ? ['beranda', 'beranda-content'] : [pageId];
    pages.forEach((p) => { p.hidden = !visible.includes(p.id); });
    pageLinks.forEach((l) => l.classList.toggle('active', l.dataset.pageLink === navId));
    mainNav.classList.remove('open');
    navToggle.setAttribute('aria-expanded', 'false');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  const go = (id) => { history.replaceState(null, '', `#${id}`); showPage(id); };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-page-link],[data-go-to],[data-information-year],[data-chart-year],[data-ranperda],[data-stage]');
    if (!el) return;
    const d = el.dataset;
    if (d.informationYear) { e.preventDefault(); go(`Informasi${d.informationYear}`); }
    else if (d.chartYear) { chartYear = Number(d.chartYear); renderCharts(); }
    else if (d.ranperda) showProgress(d.ranperda);
    else if (d.stage && el.classList.contains('stage-selector-btn')) selectStage(d.stage);
    else if (d.pageLink || d.goTo) { e.preventDefault(); go(d.pageLink || d.goTo); }
  });
  navToggle.addEventListener('click', () => {
    const open = mainNav.classList.toggle('open');
    navToggle.setAttribute('aria-expanded', String(open));
  });
  window.addEventListener('hashchange', () => showPage(location.hash.slice(1) || 'beranda'));

  // ---------- Grafik beranda ----------
  const stageCounts = (list) => STAGES.map((_, i) => list.filter((r) => r.completed > i).length);

  function renderCharts() {
    const years = DATA.years;
    $('#chart-controls').innerHTML = years
      .map((y) => `<button class="chart-btn${y === chartYear ? ' active' : ''}" type="button" data-chart-year="${y}">Tahun ${y}</button>`)
      .join('');

    const list = DATA.ranperda.filter((r) => r.year === chartYear);
    const pengusul = INITIATORS.map((n) => list.filter((r) => r.initiator === n).length);
    const total = pengusul.reduce((a, b) => a + b, 0);
    $('#pengusul-summary').innerHTML = INITIATORS.map((n, i) => {
      const pct = total ? Math.round((pengusul[i] / total) * 100) : 0;
      return `<div class="chart-summary__item"><span><span style="display:inline-block;width:10px;height:10px;border-radius:999px;background:${INITIATOR_COLORS[i]};margin-right:8px"></span>${n}</span><span class="chart-summary__value">${pengusul[i]} (${pct}%)</span></div>`;
    }).join('');

    if (typeof Chart === 'undefined') {
      $('#pengusul-summary').insertAdjacentHTML('afterbegin', '<p class="empty-note">Grafik tidak tersedia karena library Chart.js gagal dimuat.</p>');
      return;
    }
    const status = stageCounts(list);
    if (!chartPengusul) {
      chartPengusul = new Chart($('#chart-pengusul'), {
        type: 'doughnut',
        data: { labels: INITIATORS, datasets: [{ data: pengusul, backgroundColor: INITIATOR_COLORS, borderColor: '#fff', borderWidth: 2 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { font: { size: 13, weight: '600' }, padding: 15, usePointStyle: true } } } },
      });
      chartStatus = new Chart($('#chart-status'), {
        type: 'bar',
        data: { labels: STAGES, datasets: [{ label: 'Jumlah Ranperda', data: status, backgroundColor: '#0f4c81', borderColor: '#0b355a', borderWidth: 1 }] },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: true, labels: { font: { size: 12, weight: '600' }, usePointStyle: true } } },
          scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } },
        },
      });
    } else {
      chartPengusul.data.datasets[0].data = pengusul;
      chartPengusul.update();
      chartStatus.data.datasets[0].data = status;
      chartStatus.update();
    }
  }

  // ---------- PROPEMPERDA ----------
  function renderPropemperda() {
    const box = $('#propemperda-list');
    const years = DATA.years.filter((y) => DATA.propemperda.some((p) => p.year === y));
    if (!years.length) { box.innerHTML = '<p class="empty-note">Belum ada dokumen PROPEMPERDA.</p>'; return; }
    box.innerHTML = years.map((y) => {
      const cards = DATA.propemperda.filter((p) => p.year === y).sort(byDate).map((p) => `
        <a class="document-card" href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener noreferrer">
          <i class="fa-regular fa-file-pdf" aria-hidden="true"></i>
          <span>${esc(p.title)}${p.date ? ` <small>(${esc(fmtDate(p.date))})</small>` : ''}</span>
          <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i>
        </a>`).join('');
      return `<section class="year-block" aria-labelledby="year-${y}-title"><h2 id="year-${y}-title">${y}</h2><div class="document-grid">${cards}</div></section>`;
    }).join('');
  }

  // ---------- Informasi pembentukan Perda ----------
  function renderYearChoices() {
    $('#information-years').innerHTML = DATA.years.map((y) => `
      <button class="year-choice" type="button" data-information-year="${y}">
        <i class="fa-regular fa-calendar-days" aria-hidden="true"></i>
        <strong>${y}</strong>
        <span>Informasi pembentukan Perda Tahun ${y}</span>
        <small>Lihat informasi <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></small>
      </button>`).join('') || '<p class="empty-note">Belum ada data.</p>';
  }

  function renderDetail() {
    $('#informasi-detail-title').textContent = `Informasi Pembentukan Peraturan Daerah Tahun ${detailYear}`;
    $('#detail-years').innerHTML = DATA.years
      .map((y) => `<button class="chart-btn${y === detailYear ? ' active' : ''}" type="button" data-information-year="${y}">${y}</button>`)
      .join('');
    $('#progress-panel').hidden = true;
    $('#ranperda-search').value = '';
    const list = DATA.ranperda.filter((r) => r.year === detailYear);
    $('#ranperda-body').innerHTML = list.length
      ? list.map((r, i) => `
          <tr>
            <td>${i + 1}.</td>
            <td>${esc(r.title)}</td>
            <td>${esc(r.initiator)}</td>
            <td><button class="status-button" type="button" data-ranperda="${esc(r.id)}">Lihat Progres</button></td>
          </tr>`).join('')
      : '<tr><td colspan="4">Belum ada data Ranperda untuk tahun ini.</td></tr>';
  }

  $('#ranperda-search').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    $$('#ranperda-body tr').forEach((tr) => { tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none'; });
  });

  let currentRanperda = null;

  function renderTracker(completed) {
    $('#progress-tracker').innerHTML = STAGES.map((label, i) => {
      const state = i < completed ? 'done' : i === completed ? 'active' : 'pending';
      const icon = state === 'done' ? 'fa-solid fa-check' : state === 'active' ? 'fa-solid fa-spinner fa-spin' : 'fa-regular fa-circle';
      return `<div class="stage-h ${state}" data-stage="${label}">${i > 0 ? '<span class="line"></span>' : ''}<span class="node"><i class="${icon}" aria-hidden="true"></i></span><span class="stage-label">${label}</span></div>`;
    }).join('');
  }

  function selectStage(stage) {
    if (!currentRanperda) return;
    $$('.stage-selector-btn').forEach((b) => b.classList.toggle('active', b.dataset.stage === stage));
    const docs = currentRanperda.docs?.[stage] || [];
    $('#stage-docs').innerHTML = docs.length
      ? docs.map((d) => {
          const note = [d.date ? fmtDate(d.date) : '', d.note].filter(Boolean).join(' - ');
          return `
            <a href="${esc(safeUrl(d.url))}" target="_blank" rel="noopener noreferrer" class="stage-document-card">
              <div><span class="stage-document-label">${esc(d.label)}</span>${note ? `<span class="stage-document-note">${esc(note)}</span>` : ''}</div>
              <span class="progress-document-icon"><i class="fa-solid fa-file-lines" aria-hidden="true"></i></span>
            </a>`;
        }).join('')
      : '<p class="stage-document-note">Tidak ada dokumen tahap yang tersedia.</p>';
  }

  function showProgress(id) {
    const r = DATA.ranperda.find((x) => x.id === id);
    if (!r) return;
    currentRanperda = r;
    const panel = $('#progress-panel');
    panel.hidden = false;
    $('#progress-title').textContent = r.title;
    $('#progress-initiator').textContent = r.initiator || '-';
    $('#stage-buttons').innerHTML = STAGES.map((s) => `<button type="button" class="stage-selector-btn" data-stage="${s}">${s}</button>`).join('');
    renderTracker(r.completed);
    selectStage(STAGES[Math.min(r.completed, STAGES.length - 1)]);
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ---------- Survei ----------
  function buildSurvey() {
    const box = $('#survey-questions');
    let n = 0;
    box.innerHTML = DATA.survey.map((g) => `
      <fieldset class="survey-group">
        <legend>${esc(g.title)}</legend>
        ${g.questions.map((q) => {
          n += 1;
          const opts = [1, 2, 3, 4, 5].map((v) => `<input id="q${n}-${v}" name="q${n}" type="radio" value="${v}" required /><label for="q${n}-${v}" aria-label="Nilai ${v}">${v}</label>`).join('');
          return `<div class="survey-question"><span>${n}. ${esc(q)}</span><div class="rating-options" aria-label="Nilai pertanyaan ${n}">${opts}</div></div>`;
        }).join('')}
      </fieldset>`).join('');
  }

  $('#survey-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const fb = $('#survey-feedback');
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    fb.textContent = 'Mengirim...';
    try {
      const res = await fetch('/api/survey', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      const out = await res.json().catch(() => ({}));
      if (res.ok) { fb.textContent = 'Terima kasih! Data survei berhasil dikirim.'; form.reset(); }
      else fb.textContent = out.error || 'Gagal mengirim survei. Coba lagi nanti.';
    } catch {
      fb.textContent = 'Terjadi kesalahan saat mengirim survei. Silakan coba lagi.';
    }
    btn.disabled = false;
  });

  // ---------- Footer: jam, tahun, pengunjung ----------
  function updateFooterTime() {
    const now = new Date();
    const clock = (tz) => new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: tz }).format(now);
    $('#footer-date').textContent = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' }).format(now);
    $('#footer-clock-wib').textContent = clock('Asia/Jakarta');
    $('#footer-clock-wita').textContent = clock('Asia/Makassar');
    $('#footer-clock-wit').textContent = clock('Asia/Jayapura');
  }

  function countVisit() {
    const show = (n) => { $('#visitor-count').textContent = Number(n || 0).toLocaleString('id-ID'); };
    show(DATA.visits);
    try { if (sessionStorage.getItem('visited')) return; } catch {}
    fetch('/api/visit', { method: 'POST' })
      .then((r) => r.json())
      .then((d) => { show(d.total); try { sessionStorage.setItem('visited', '1'); } catch {} })
      .catch(() => {});
  }

  // ---------- Mulai ----------
  async function init() {
    $('#current-year').textContent = new Date().getFullYear();
    updateFooterTime();
    setInterval(updateFooterTime, 1000);
    try {
      const res = await fetch('/api/public', { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status);
      DATA = await res.json();
    } catch (err) {
      console.error('Gagal memuat data:', err);
      $('#load-error').hidden = false;
    }
    chartYear = DATA.years[DATA.years.length - 1] ?? null;
    renderCharts();
    renderPropemperda();
    renderYearChoices();
    buildSurvey();
    showPage(location.hash.slice(1) || 'beranda');
    countVisit();
  }
  init();
})();
