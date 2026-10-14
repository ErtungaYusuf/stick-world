// REST + WebSocket client.
export async function api(path, body) {
  const res = await fetch('/api' + path, body === undefined ? undefined : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
}

// handlers: { [messageType]: fn(msg), open(), close() } — reconnects automatically
export function connect(handlers) {
  let ws = null;
  const open = () => {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onopen = () => handlers.open && handlers.open();
    ws.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      const h = handlers[m.t];
      if (h) h(m);
    };
    ws.onclose = () => { handlers.close && handlers.close(); setTimeout(open, 1500); };
  };
  open();
  return { send: m => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); } };
}
