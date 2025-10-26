// ==========================================
//  ST24 Control Server - Porta 3400
// ==========================================
import express from 'express';
import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';

const app = express();
app.use(express.json());
app.use(express.static('public'));

let port, parser;
let busy = false; // evita cicli sovrapposti

// ======================================================
// 🔍 elenco porte seriali
// ======================================================
app.get('/api/ports', async (req, res) => {
  try {
    const ports = await SerialPort.list();
    const filtered = ports.filter(p =>
      p.path && p.path.match(/(ttyUSB|ttyS|ttyACM|COM\d+)/)
    );
    res.json(filtered.map(p => p.path));
    console.log('🔎 Porte trovate:', filtered.map(p => p.path));
  } catch (err) {
    console.error('❌ Errore elenco porte:', err);
    res.status(500).json({ error: 'Impossibile leggere le porte seriali' });
  }
});

// ======================================================
// 🔌 Apertura porta seriale
// ======================================================
app.post('/api/connect', (req, res) => {
  const { path, baudRate = 9600 } = req.body;
  if (!path) return res.status(400).json({ error: 'Parametro "path" mancante' });

  if (port && port.isOpen) port.close();
  port = new SerialPort({
    path,
    baudRate,
    dataBits: 8,
    stopBits: 1,
    parity: 'none',
    rtscts: false
  });
  parser = port.pipe(new ReadlineParser({ delimiter: '\r' }));

  port.on('open', () => console.log(`✅ Porta ${path} aperta`));
  port.on('error', err => console.error('❌ Errore porta:', err.message));
  parser.on('data', line => console.log('📥 RX:', line.trim()));

  res.json({ ok: true });
});

// ======================================================
// 🛰️ Invio comando singolo
// ======================================================
app.post('/api/send', (req, res) => {
  if (!port || !port.isOpen)
    return res.status(400).json({ error: 'Porta non aperta' });

  const { cmd } = req.body;
  const toSend = cmd.endsWith('\r') ? cmd : cmd + '\r';
  console.log('➡️ TX:', cmd);
  port.write(toSend, err => {
    if (err) console.error('Errore scrittura:', err.message);
  });
  res.json({ sent: cmd });
});

// ======================================================
// 🔄 Lettura completa: $ -> R -> P -> H -> G -> ^S -> %
// ======================================================
app.get('/api/status', async (req, res) => {
  if (!port || !port.isOpen)
    return res.json({ connected: false });

  if (busy) {
    return res.json({ connected: true, busy: true });
  }
  busy = true;

  const sendAndWait = (cmd) =>
    new Promise((resolve) => {
      const lines = [];
      let started = false;
      const onData = (line) => {
        const clean = line.trim();
        if (!clean) return;

        if (!started && clean === '>') {
          started = true;
          return;
        }

        if (started && ['>', '#', '*'].includes(clean)) {
          parser.off('data', onData);
          resolve(lines);
          return;
        }

        started = true;
        lines.push(clean);
      };

      parser.on('data', onData);
      console.log('➡️ TX:', cmd);
      port.write(cmd + '\r');

      setTimeout(() => {
        parser.off('data', onData);
        if (lines.length === 0) lines.push('(timeout)');
        resolve(lines);
      }, 1000); // tempo massimo per ogni comando
    });

  const delay = (ms) => new Promise(r => setTimeout(r, ms));
  const result = {};

  try {
    await sendAndWait('$');
    await delay(150);
    result.signal = parseR(await sendAndWait('R'));
    await delay(150);
    result.position = parseP(await sendAndWait('P'));
    await delay(150);
    result.inclin = parseH(await sendAndWait('H'));
    await delay(150);
    result.attitude = parseG(await sendAndWait('G'));
    await delay(150);
    result.status = parseStatus(await sendAndWait('^S'));
    await delay(150);
    await sendAndWait('%');
  } catch (e) {
    console.error('Errore lettura sequenza:', e);
  } finally {
    busy = false;
  }

  // ✅ restituisce sempre un JSON valido anche se vuoto
  res.json({ connected: true, ...result });
});


// ======================================================
// PARSER COMANDI - Versione aggiornata per ST24 reale
// ======================================================
function parseR(lines) {
  const data = lines.find(l => l.includes('L')) || '';
  // esempio: >L2234t2033N055F@@R1:35
  const match = data.match(/L(\d+)t(\d+)N(\d+).*:(\d+)/);
  return match
    ? {
        level: Number(match[1]),    // Livello segnale
        threshold: Number(match[2]),// soglia
        nid: match[3],              // NID
        count: Number(match[4])     // contatore
      }
    : {};
}

function parseP(lines) {
  const data = lines.find(l => l.startsWith('E')) || '';
  // Esempio: >E0372A1993p0015R0000
  const match = data.match(/E(\d+)A(\d+)p(\d+)R(\d+)/i);
  if (!match) return {};
  return {
    el: Number(match[1]) / 10,   // Elevazione
    az: Number(match[2])  /10, // Azimut
    pol: Number(match[3]) /10, // Polarizzazione
    rel: Number(match[4])   // Riserva / RelAz
  };
}


function parseH(lines) {
  const data = lines.find(l => l.includes('XT')) || '';
  // esempio: >XT:+00.0, YT:-01.1, RP:+014.7:+014.8
  const match = data.match(/XT:([+-]?\d+\.\d+),\s*YT:([+-]?\d+\.\d+),\s*RP:([+-]?\d+\.\d+):([+-]?\d+\.\d+)/);
  return match
    ? { xt: +match[1], yt: +match[2], rp1: +match[3], rp2: +match[4] }
    : {};
}

function parseG(lines) {
  const data = lines.find(l => l.includes('RL:')) || '';
  // esempio: >RL:+00.1, PT:-01.1, YA:199.5
  const match = data.match(/RL:([+-]?\d+\.\d+),\s*PT:([+-]?\d+\.\d+),\s*YA:(\d+\.\d+)/);
  return match
    ? { roll: +match[1], pitch: +match[2], yaw: +match[3] }
    : {};
}

function parseStatus(lines) {
  const data = lines.find(l => /^[0-9A-Fa-f]{4}$/.test(l));
  if (!data) return {};
  const val = parseInt(data, 16);
  return {
    raw: data,
    NIDOK: !!(val & 0x0001),
    TRACKF: !!(val & 0x0002),
    THRSF: !!(val & 0x0004),
    SRCHF: !!(val & 0x0008),
  };
}

const PORT = 3400;
app.listen(PORT, () => console.log(`✅ Server ST24 in ascolto su http://localhost:${PORT}`));
