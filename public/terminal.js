let socket;
let term;
let fitAddon;
let authToken = null;
let ctrlActive = false;

// Initialize
const savedPass = sessionStorage.getItem("pocket_pass");
if (savedPass) {
  authToken = savedPass;
  connect(savedPass);
}

document.getElementById("login-form").onsubmit = (e) => {
  e.preventDefault();
  const pass = document.getElementById("password").value;
  const toggleBtn = document.getElementById("toggle-password");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      const input = document.getElementById("password");
      const isPassword = input.type === "password";
      input.type = isPassword ? "text" : "password";
      toggleBtn.textContent = isPassword ? "🙈" : "👁️";
      toggleBtn.setAttribute(
        "aria-label",
        isPassword ? "Hide password" : "Show password",
      );
    });
  }
  connect(pass);
};

function connect(password) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${protocol}//${window.location.host}`);

  socket.onopen = () => {
    socket.send(JSON.stringify({ type: "auth", password: password.trim() }));
  };

  socket.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.type === "authenticated") {
      authToken = password.trim();
      sessionStorage.setItem("pocket_pass", authToken);
      showScreen("launcher-screen");
      loadProjects();
    } else if (data.type === "error") {
      document.getElementById("login-error").innerText = data.message;
      sessionStorage.removeItem("pocket_pass");
    } else if (data.type === "data") {
      if (term) term.write(data.data);
    } else if (data.type === "exit") {
      closeTerminal();
    }
  };

  socket.onclose = () => {
    document.getElementById("status").innerText = "● OFFLINE";
    document.getElementById("status").style.color = "var(--error)";
    // Auto-reconnect if we were already logged in
    if (authToken) setTimeout(() => connect(authToken), 3000);
  };
}

async function loadProjects() {
  try {
    const res = await fetch("/api/projects", {
      headers: { Authorization: authToken },
    });
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
    console.error("Failed to load projects");
  }
}

async function cloneRepo() {
  const url = document.getElementById("repo-url").value;
  const token = document.getElementById("repo-token").value;
  if (!url) return alert("Enter a URL");

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
    if (data.error) throw new Error(data.error);
    alert("Cloned successfully!");
    loadProjects();
  } catch (err) {
    alert("Clone failed: " + err.message);
  }
}

function launchCLI(command, args = []) {
  const projectId = document.getElementById("project-select").value;
  showScreen("terminal-screen");
  document.getElementById("term-title").innerText = command;

  if (!term) {
    term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      theme: {
        background: "#000000",
        foreground: "#ffffff",
      },
    });
    fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(document.getElementById("terminal-container"));
    fitAddon.fit();

    term.onData((data) => {
      if (ctrlActive) {
        const code = data.charCodeAt(0);
        if (code >= 97 && code <= 122) {
          // a-z
          socket.send(
            JSON.stringify({
              type: "data",
              data: String.fromCharCode(code - 96),
            }),
          );
        }
        toggleCtrl(); // Deactivate after one use
      } else {
        socket.send(JSON.stringify({ type: "data", data }));
      }
    });

    window.addEventListener("resize", () => {
      fitAddon.fit();
      socket.send(
        JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }),
      );
    });
  }

  // Clear term before re-attach
  term.clear();
  socket.send(
    JSON.stringify({
      type: "spawn",
      command,
      args,
      projectId,
      cols: term.cols,
      rows: term.rows,
    }),
  );
}

function sendKey(key) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "data", data: key }));
  }
}

function toggleCtrl() {
  ctrlActive = !ctrlActive;
  document.getElementById("ctrl-toggle").classList.toggle("active", ctrlActive);
}

function showScreen(id) {
  document
    .querySelectorAll(".screen")
    .forEach((s) => s.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
  if (id === "terminal-screen" && fitAddon) {
    setTimeout(() => fitAddon.fit(), 100);
  }
}

function closeTerminal() {
  showScreen("launcher-screen");
}

function logout() {
  sessionStorage.removeItem("pocket_pass");
  window.location.reload();
}
