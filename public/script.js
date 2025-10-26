let updateTimer = null;
let connected = false;
let blinkState = false;

// 🔄 carica porte seriali
async function loadPorts() {
  try {
    const res = await fetch('/api/ports');
    const ports = await res.json();
    const sel = document.getElementById('ports');
    if (!sel) return;

    sel.innerHTML = ports.map(p => `<option>${p}</option>`).join('');
    if (ports.length > 0) sel.value = ports[0];
    console.log("🔌 Porte disponibili:", ports);
  } catch (err) {
    console.error('Errore caricamento porte:', err);
  }
}

// 🔌 connessione
async function connect() {
  const pathEl = document.getElementById('ports');
  const statusEl = document.getElementById('status');
  if (!pathEl || !statusEl) return;

  const path = pathEl.value;
  try {
    const res = await fetch('/api/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path })
    });
    const data = await res.json();
    if (data.ok) {
      statusEl.textContent = `Connesso a ${path}`;
      statusEl.className = 'ok';
      connected = true;
      log(`✅ Connesso a ${path}`);
    } else {
      statusEl.textContent = 'Errore connessione';
      statusEl.className = 'err';
      log('❌ Errore connessione');
    }
  } catch (err) {
    statusEl.textContent = 'Connessione fallita';
    statusEl.className = 'err';
    log(`❌ ${err.message}`);
  }
}

// 📤 invio comando manuale
async function sendCmd(cmd) {
  log(`→ ${cmd}`);
  try {
    await fetch('/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd })
    });
  } catch (err) {
    log(`Errore invio comando: ${err.message}`);
  }
}

// 🔁 aggiornamento periodico
async function updateStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    if (!data.connected) {
      setStatus('Porta non aperta', 'err');
      return;
    }
    if (data.busy) return; // backend occupato

    blink(); // lampeggia LED
    setStatus('Antenna collegata', 'ok');
    updateData(data);
    updateTimestamp();
  } catch (err) {
    setStatus('Errore comunicazione', 'err');
    console.warn('Errore updateStatus:', err);
  }
}

// 🧩 aggiorna tutti i campi della pagina
function updateData(data) {
  const map = {
    level: data.signal?.level,
    nid: data.signal?.nid,
    az: data.position?.az,
    el: data.position?.el,
    pol: data.position?.pol,
    roll: data.attitude?.roll,
    pitch: data.attitude?.pitch,
    yaw: data.attitude?.yaw
  };
  for (const [id, val] of Object.entries(map)) {
    const el = document.getElementById(id);
    if (el) el.textContent = (val ?? '-');
  }
}

// 💡 stato connessione
function setStatus(msg, cls) {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = msg + " ";
  el.className = cls;
  const blinkEl = document.getElementById('blink');
  if (blinkEl) el.appendChild(blinkEl);
}

// 💾 log a schermo
function log(msg) {
  const div = document.getElementById('log');
  if (!div) return;
  const ts = new Date().toLocaleTimeString();
  div.textContent += `[${ts}] ${msg}\n`;
  div.scrollTop = div.scrollHeight;
}

// 🔘 LED lampeggiante
function blink() {
  const led = document.getElementById('blink');
  if (!led) return; // evita crash se non esiste
  blinkState = !blinkState;
  led.style.background = blinkState ? 'limegreen' : '#ccc';
}

// 🕒 timestamp ultimo aggiornamento
function updateTimestamp() {
  let t = document.getElementById('lastUpdate');
  if (!t) {
    t = document.createElement('span');
    t.id = 'lastUpdate';
    t.style.marginLeft = '8px';
    document.getElementById('status')?.appendChild(t);
  }
  const now = new Date();
  t.textContent = `(ultimo aggiornamento: ${now.toLocaleTimeString()})`;
}

// ⚙️ avvio automatico al caricamento
window.addEventListener('DOMContentLoaded', () => {
  console.log("🟢 Interfaccia ST24 avviata");
  loadPorts();
  updateTimer = setInterval(updateStatus, 2000);
});
