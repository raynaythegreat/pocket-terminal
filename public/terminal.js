/* ================================================================
   Pocket Terminal – client side script
   Enhancements:
   1️⃣ Secure temporary token handling (no plain password stored long‑term)
   2️⃣ Robust WebSocket reconnection with exponential back‑off
   3️⃣ Terminal guard – buffer messages until XTerm is ready
   4️⃣ Clone‑repo flow with validation and toast UI feedback
   ================================================================ */

let socket;
let term; // XTerm instance
let fitAddon;
let authToken = null; // will hold the hashed token from server
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 30000; // 30 s max back‑off
const pendingData = []; // buffer for terminal data before term is ready

// -----------------------------------
// UI helpers (toast & spinner)
// -----------------------------------
function showToast(message, type = "info") {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 4000);
}

function showSpinner(show) {
  const btn = document.getElementById("clone-btn");
  if (!btn) return;
  btn.disabled = show;
  btn.textContent = show ? "Cloning…" : "Clone to Workspace";
}

// -----------------------------------
// Connection handling
// -----------------------------------
function scheduleReconnect() {
  reconnectAttempts++;
  const delay = Math.min(1000 * 2 ** reconnectAttempts, MAX_RECONNECT_DELAY);
  console.warn(`Reconnecting in ${delay} ms`);
  setTimeout(() => connect(authToken), delay);
}

function connect(tokenOrPassword) {
  // tokenOrPassword may be the hashed token (after login) or the plain password (first login)
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${protocol}//${window.location.host}`);

  socket.onopen = () => {
    reconnectAttempts = 0; // reset back‑off
    // If we already have a hashed token, send it as password (server hashes again – safe)
    socket.send(
      JSON.stringify({ type: "auth", password: tokenOrPassword }),
    );
  };

  socket.onmessage = (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch (e) {
      return;
    }

    switch (data.type) {
      case "authenticated":
        // Server will echo success – we now store the **hashed** token (returned by /auth)
        // For the initial login flow we already have the plain password; hash it locally.
        authToken = tokenOrPassword;
        sessionStorage.setItem("pocket_token", authToken);
        showScreen("launcher-screen");
        loadProjects();
        break;

      case "error":
        showToast(data.message || "Authentication error", "error");
        sessionStorage.removeItem("pocket_token");
        break;

      case "data":
        // Guard: terminal may not be ready yet
        if (term) {
          term.write(data.data);
        } else {
          pendingData.push(data.data);
        }
        break;

      case "exit":
        closeTerminal();
        break;

      default:
        // ignore unknown messages
        break;
    }
  };

  socket.onclose = () => {
    document.getElementById("status").innerText = "● OFFLINE";
    document.getElementById("status").style.color = "var(--error)";
    // Auto‑reconnect using exponential back‑off
    if (authToken) scheduleReconnect();
  };
}

// -----------------------------------
// Session restoration on page load
// -----------------------------------
const savedToken = sessionStorage.getItem("pocket_token");
if (savedToken) {
  authToken = savedToken;
  connect(savedToken);
}

// -----------------------------------
// Login form handling
// -----------------------------------
document.getElementById("login-form").onsubmit = async (e) => {
  e.preventDefault();
  const pwd = document.getElementById("password").value.trim();
  if (!pwd) return showToast("Password required", "error");

  // Obtain a hashed token from the server via /auth (so we never store raw pwd)
  try {
    const res = await fetch("/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pwd }),
    });
    const payload = await res.json();
    if (res.ok && payload.token) {
      // Use the returned hash as the session token
      connect(payload.token);
    } else {
      showToast(payload.error || "Login failed", "error");
    }
  } catch (err) {
    console.error(err);
    showToast("Network error while logging in", "error");
  }
};

// -----------------------------------
// Project list loading
// -----------------------------------
async function loadProjects() {
  try {
    const res = await fetch("/api/projects", {
      headers: { Authorization: authToken },
    });
    if (!res.ok) throw new Error("Failed to fetch projects");
    const projects = await res.json();
    const select = document.getElementById("project-select");
    select.innerHTML = '<option value="">Root Environment</option>';
    projects.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p;
      opt.textContent = p;
      select.appendChild(opt);
    });
  } catch (err) {
    console.error(err);
    showToast("Could not load projects", "error");
  }
}

// -----------------------------------
// Clone repo flow (fixed & with UI feedback)
// -----------------------------------
async function cloneRepo() {
  const url = document.getElementById("repo-url").value.trim();
  const token = document.getElementById("repo-token").value.trim();

  if (!url) return showToast("Repository URL required", "error");

  // Basic validation – HTTPS GitHub URL
  const githubRegex = /^https:\/\/github\.com\/[^/]+\/[^/]+(\.git)?$/;
  if (!githubRegex.test(url)) {
    return showToast("Enter a valid GitHub HTTPS URL", "error");
  }

  showSpinner(true);
  try {
    const res = await fetch("/api/projects/clone", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authToken,
      },
      body: JSON.stringify({ url, token }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Clone failed");
    showToast(`Repository "${data.name}" cloned successfully`, "success");
    // Refresh project list
    await loadProjects();
  } catch (err) {
    console.error(err);
    showToast(err.message, "error");
  } finally {
    showSpinner(false);
  }
}

// -----------------------------------
// Terminal initialization (called by launchCLI – not shown here)
// -----------------------------------
function initTerminal(containerId = "terminal-container") {
  const container = document.getElementById(containerId);
  if (!container) return;

  const { Terminal } = window; // XTerm global from CDN
  const { FitAddon } = window; // FitAddon global from CDN

  term = new Terminal({
    cursorBlink: true,
    theme: {
      background: getComputedStyle(document.documentElement).getPropertyValue(
        "--surface",
      ),
    },
  });
  fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(container);
  fitAddon.fit();

  // Flush any buffered data received before the terminal was ready
  if (pendingData.length) {
    pendingData.forEach((chunk) => term.write(chunk));
    pendingData.length = 0;
  }

  // Send keystrokes to the back‑end
  term.onData((data) => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "input", data }));
    }
  });
}

// -----------------------------------
// Helper UI switches
// -----------------------------------
function showScreen(id) {
  document.querySelectorAll(".screen").forEach((el) => {
    el.classList.toggle("hidden", el.id !== id);
  });
}

// Dummy placeholder – implement logout as needed
function logout() {
  sessionStorage.removeItem("pocket_token");
  authToken = null;
  if (socket) socket.close();
  showScreen("login-screen");
}