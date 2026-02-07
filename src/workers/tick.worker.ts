let intervalId: ReturnType<typeof setInterval> | null = null;

self.onmessage = (e: MessageEvent) => {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  if (e.data === 'stop') return;
  // e.data is the target FPS
  const fps = typeof e.data === 'number' ? e.data : 30;
  intervalId = setInterval(() => self.postMessage('tick'), 1000 / fps);
};
