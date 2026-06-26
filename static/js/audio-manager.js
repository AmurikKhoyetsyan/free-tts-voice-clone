// Singleton audio manager: only ONE source plays at a time.
// All custom AudioPlayer instances register here.

const subscribers = new Set();
let current = null;  // currently playing AudioPlayer instance

export const audioManager = {
    play(player) {
        if (current && current !== player) {
            try { current.pause(); } catch (_) {}
        }
        current = player;
        notify();
    },
    stop(player) {
        if (current === player) {
            current = null;
            notify();
        }
    },
    stopAll() {
        if (current) {
            try { current.pause(); } catch (_) {}
        }
        current = null;
        notify();
    },
    get current() { return current; },
    subscribe(fn) {
        subscribers.add(fn);
        return () => subscribers.delete(fn);
    },
};

function notify() {
    subscribers.forEach(fn => {
        try { fn(current); } catch (_) {}
    });
}
