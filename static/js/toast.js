const host = document.getElementById('toasts');

export function toast(message, level = 'info', timeout = 3500) {
    if (!host) return;
    const el = document.createElement('div');
    el.className = 'toast' + (level && level !== 'info' ? ' ' + level : '');
    el.textContent = message;
    host.appendChild(el);
    setTimeout(() => {
        el.style.transition = 'opacity 0.2s, transform 0.2s';
        el.style.opacity = '0';
        el.style.transform = 'translateY(-4px)';
        setTimeout(() => el.remove(), 220);
    }, timeout);
}
