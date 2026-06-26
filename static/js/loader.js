// Universal "data is loading" helpers.
//
// withLoader(hostEl, asyncFn): shows a spinner overlay on hostEl, runs asyncFn,
//   removes overlay when done. Returns the asyncFn's resolved value (or throws).
// makeSkeleton(host, kind): replaces host innerHTML with skeleton placeholders.
//   kind: 'list-rows' | 'dropdown' | 'lines'

export async function withLoader(host, fn) {
    if (!host) return await fn();
    const prevPos = host.style.position;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    const ov = document.createElement('div');
    ov.className = 'loader-ov';
    ov.innerHTML = '<div class="loader-spin"></div>';
    host.appendChild(ov);
    try {
        return await fn();
    } finally {
        ov.remove();
        if (prevPos === '') host.style.position = '';
    }
}

export function setLoading(host, on) {
    if (!host) return;
    let ov = host.querySelector(':scope > .loader-ov');
    if (on) {
        if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
        if (!ov) {
            ov = document.createElement('div');
            ov.className = 'loader-ov';
            ov.innerHTML = '<div class="loader-spin"></div>';
            host.appendChild(ov);
        }
    } else if (ov) {
        ov.remove();
    }
}

export function skeletonRows(host, count = 3) {
    if (!host) return;
    host.innerHTML = Array.from({ length: count })
        .map(() => '<div class="sk-row"><div class="sk-bar"></div></div>')
        .join('');
}

export function skeletonLines(host, count = 3) {
    if (!host) return;
    host.innerHTML = Array.from({ length: count })
        .map((_, i) => `<div class="sk-line"${i === count - 1 ? ' style="width:60%"' : ''}></div>`)
        .join('');
}
