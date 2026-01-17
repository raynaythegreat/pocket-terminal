function scheduleFit() {
  if (!term ||!fitAddon) return;

  // Optimize the fitting process to improve performance
  requestAnimationFrame(() => {
    try {
      fitAddon.fit();
    } catch (e) {
      console.warn("Terminal fit error:", e);
    }
  });
}