// Thin wrappers around backend API.

export async function getJSON(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(await r.text() || r.statusText);
    return r.json();
}

export async function postJSON(url, body) {
    const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error((await safeText(r)) || r.statusText);
    return r.json();
}

export async function putJSON(url, body) {
    const r = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error((await safeText(r)) || r.statusText);
    return r.json();
}

export async function del(url) {
    const r = await fetch(url, { method: 'DELETE' });
    if (!r.ok) throw new Error((await safeText(r)) || r.statusText);
    return r.json();
}

export async function uploadForm(url, formData) {
    const r = await fetch(url, { method: 'POST', body: formData });
    if (!r.ok) throw new Error((await safeText(r)) || r.statusText);
    return r.json();
}

async function safeText(r) {
    try {
        const t = await r.text();
        try {
            const j = JSON.parse(t);
            return j.detail || j.message || t;
        } catch (_) { return t; }
    } catch (_) { return ''; }
}

// SSE-style synthesis stream — POST + ReadableStream.
// Calls handlers.progress(value, desc), handlers.done(payload), handlers.error(msg).
export async function synthesizeStream(url, opts, handlers) {
    const r = await fetch(url, opts);
    if (!r.ok) {
        const msg = await safeText(r);
        handlers.error && handlers.error(msg || r.statusText);
        return;
    }
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        // SSE frames separated by blank line.
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const evt = parseSSE(chunk);
            if (!evt) continue;
            if (evt.event === 'progress' && handlers.progress) {
                handlers.progress(evt.data.value, evt.data.desc);
            } else if (evt.event === 'done' && handlers.done) {
                handlers.done(evt.data);
            } else if (evt.event === 'error' && handlers.error) {
                handlers.error(evt.data.status || 'unknown error');
            }
        }
    }
}

function parseSSE(chunk) {
    const lines = chunk.split('\n');
    let event = 'message';
    let dataLines = [];
    for (const line of lines) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    if (!dataLines.length) return null;
    try {
        return { event, data: JSON.parse(dataLines.join('\n')) };
    } catch (_) {
        return { event, data: dataLines.join('\n') };
    }
}
