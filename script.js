// ==========================================
// Print Spooler Simulator - Core Engine
// ==========================================

// Global State Management
let queue = [];
let archive = [];
let isPrinting = false;
let isPaused = false;
let activeJob = null;
let currentMode = "manual"; // "manual" | "auto" | "batch"
let currentAlgorithm = "fifo"; // "fifo" | "priority" | "sjf"
let jobIdCounter = 101;
let orderCounter = 0;
let isBatchRunning = false;
let simulationSpeed = 1; // 1x, 2x, 5x, 10x
let activePrintInterval = null;

// Telemetry Stats
let stats = {
  totalJobsPrinted: 0,
  totalPagesPrinted: 0,
  totalSpoolTimeMs: 0
};

// Audio Synthesizer (Web Audio API)
let soundEnabled = false;
let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  return audioCtx;
}

function playSound(type) {
  if (!soundEnabled) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    if (type === "click") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(600, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.05);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.05);
    } else if (type === "step") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(120, ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(80, ctx.currentTime + 0.04);
      gain.gain.setValueAtTime(0.03, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.04);
    } else if (type === "complete") {
      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.08);
        gain.gain.setValueAtTime(0.07, ctx.currentTime + idx * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.08 + 0.2);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + idx * 0.08);
        osc.stop(ctx.currentTime + idx * 0.08 + 0.2);
      });
    }
  } catch (err) {
    console.debug("Audio error", err);
  }
}

// Initialize PDF.js worker
if (window.pdfjsLib) {
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js";
  } catch (e) {
    console.warn("PDF.js worker could not be configured:", e);
  }
}

// Tab Switching
function switchTab(tab) {
  playSound("click");
  const fileBtn = document.getElementById("tab-file-btn");
  const linkBtn = document.getElementById("tab-link-btn");
  const fileForm = document.getElementById("file-form");
  const linkForm = document.getElementById("link-form");

  if (tab === "file") {
    fileBtn.classList.add("active");
    linkBtn.classList.remove("active");
    fileForm.classList.remove("hidden");
    linkForm.classList.add("hidden");
  } else {
    linkBtn.classList.add("active");
    fileBtn.classList.remove("active");
    linkForm.classList.remove("hidden");
    fileForm.classList.add("hidden");
  }
}

// Add PDF File Job
document.getElementById("file-form").addEventListener("submit", async function (e) {
  e.preventDefault();
  const fileInput = document.getElementById("pdf-input");
  const priority = document.getElementById("file-priority").value;

  if (!fileInput.files || fileInput.files.length === 0) {
    showNotification("Please select a PDF file first.", "warning");
    return;
  }

  const file = fileInput.files[0];
  let pages = 1;

  // Extract real page count using PDF.js if available
  try {
    if (window.pdfjsLib && file.type === "application/pdf") {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      pages = pdf.numPages || 1;
    }
  } catch (err) {
    console.warn("Could not extract PDF page count, defaulting to 1 page.", err);
  }

  const job = {
    id: `JOB-${jobIdCounter++}`,
    name: file.name,
    type: "File",
    pages: Math.max(1, pages),
    priority: priority,
    order: ++orderCounter,
    sizeKb: Math.round(file.size / 1024) || 24,
    timestamp: new Date().toLocaleTimeString(),
  };

  enqueueJob(job);
  fileInput.value = "";
  const dropLabel = document.getElementById("file-drop-name");
  if (dropLabel) dropLabel.textContent = "Click or drag & drop a PDF file here";
  showNotification(`Added "${job.name}" (${job.pages} pgs) to queue.`, "success");
});

// Add Link Job
document.getElementById("link-form").addEventListener("submit", function (e) {
  e.preventDefault();
  const urlInput = document.getElementById("link-url");
  const titleInput = document.getElementById("link-title");
  const pagesInput = document.getElementById("link-pages");
  const priority = document.getElementById("link-priority").value;

  const url = urlInput.value.trim();
  const title = titleInput.value.trim();
  const pages = Math.max(1, parseInt(pagesInput.value, 10) || 1);

  const job = {
    id: `JOB-${jobIdCounter++}`,
    name: `${title} (${url})`,
    rawTitle: title,
    type: "Link",
    pages: pages,
    priority: priority,
    order: ++orderCounter,
    sizeKb: pages * 35,
    timestamp: new Date().toLocaleTimeString(),
  };

  enqueueJob(job);
  urlInput.value = "";
  titleInput.value = "";
  pagesInput.value = "1";
  showNotification(`Added "${title}" (${job.pages} pgs) to queue.`, "success");
});

// Enqueue Logic with Algorithm Application
function enqueueJob(job) {
  playSound("click");
  queue.push(job);
  applySchedulingAlgorithm();
  updateUI();
  checkAutoOrBatchTrigger();
}

// Quick Sample Job Creator
function addSampleJob(preset) {
  playSound("click");
  const presets = {
    quick: { name: "Boarding_Pass.pdf", type: "File", pages: 1, priority: "High", sizeKb: 85 },
    report: { name: "Quarterly_Financials_Q4.pdf", type: "File", pages: 12, priority: "Normal", sizeKb: 1420 },
    urgent: { name: "Legal_Contract_Addendum.pdf", type: "File", pages: 4, priority: "Urgent", sizeKb: 340 },
    memo: { name: "Team_All_Hands_Memo (internal.corp/memo)", type: "Link", pages: 2, priority: "Normal", sizeKb: 45 }
  };

  const template = presets[preset] || presets.quick;
  const job = {
    id: `JOB-${jobIdCounter++}`,
    name: template.name,
    type: template.type,
    pages: template.pages,
    priority: template.priority,
    order: ++orderCounter,
    sizeKb: template.sizeKb,
    timestamp: new Date().toLocaleTimeString()
  };

  enqueueJob(job);
  showNotification(`Queued sample job "${job.name}"`, "info");
}

// Add 3 Batch Sample Jobs
function addBatchSampleJobs() {
  addSampleJob("quick");
  setTimeout(() => addSampleJob("urgent"), 50);
  setTimeout(() => addSampleJob("report"), 100);
}

// Sort Queue according to chosen Algorithm
function applySchedulingAlgorithm() {
  if (currentAlgorithm === "priority") {
    const priorityWeight = { Urgent: 3, High: 2, Normal: 1 };
    queue.sort((a, b) => {
      const weightDiff = (priorityWeight[b.priority] || 1) - (priorityWeight[a.priority] || 1);
      if (weightDiff !== 0) return weightDiff;
      return a.order - b.order; // FIFO tie-breaker
    });
  } else if (currentAlgorithm === "sjf") {
    queue.sort((a, b) => {
      const pageDiff = a.pages - b.pages;
      if (pageDiff !== 0) return pageDiff;
      return a.order - b.order; // FIFO tie-breaker
    });
  } else {
    // Standard FIFO: sort purely by insertion arrival order
    queue.sort((a, b) => a.order - b.order);
  }
}

function handleAlgorithmChange(algo) {
  playSound("click");
  currentAlgorithm = algo;
  applySchedulingAlgorithm();
  updateUI();
  showNotification(`Switched algorithm to ${algo.toUpperCase()}`, "info");
}

function handleModeChange(mode) {
  playSound("click");
  currentMode = mode;
  if (currentMode !== "batch") {
    isBatchRunning = false;
  }
  updateUI();
  checkAutoOrBatchTrigger();
  showNotification(`Execution mode set to ${mode.toUpperCase()}`, "info");
}

function handleSpeedChange(speed) {
  simulationSpeed = parseFloat(speed) || 1;
  const label = document.getElementById("speed-label");
  if (label) label.textContent = `${simulationSpeed}x`;
  playSound("click");
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  if (soundEnabled) {
    getAudioContext();
    playSound("click");
  }
  const btn = document.getElementById("sound-toggle-btn");
  if (btn) {
    btn.innerHTML = soundEnabled ? "🔊 Sound: ON" : "🔇 Sound: OFF";
    btn.classList.toggle("btn-active-toggle", soundEnabled);
  }
}

function checkAutoOrBatchTrigger() {
  if (isPrinting) return;

  if (currentMode === "auto" && queue.length > 0) {
    processNextJob();
  } else if (currentMode === "batch") {
    if (!isBatchRunning && queue.length >= 3) {
      isBatchRunning = true;
      showNotification("Batch threshold (3 jobs) reached! Processing batch...", "info");
      processNextJob();
    } else if (isBatchRunning && queue.length > 0) {
      processNextJob();
    } else if (isBatchRunning && queue.length === 0) {
      isBatchRunning = false;
      showNotification("Batch execution completed.", "success");
    }
  }
}

// Process the job at the front of the queue (Dequeue)
function processNextJob() {
  if (isPrinting) return;
  if (queue.length === 0) {
    isBatchRunning = false;
    updateUI();
    return;
  }

  isPrinting = true;
  isPaused = false;
  activeJob = queue.shift();
  updateUI();

  // Update Printer UI Elements
  const printerStatusEl = document.getElementById("printer-status");
  const currentJobTextEl = document.getElementById("current-job-text");
  const progressBar = document.getElementById("progress-bar");
  const progressText = document.getElementById("progress-text");
  const pageIndicator = document.getElementById("page-indicator");
  const printerHardware = document.getElementById("printer-hardware");

  if (printerHardware) {
    printerHardware.classList.add("printing-active");
  }

  printerStatusEl.innerText = `Status: PRINTING (${activeJob.id})`;
  currentJobTextEl.innerText = `Current Job: ${activeJob.name} (${activeJob.pages} ${activeJob.pages === 1 ? "page" : "pages"})`;

  let progress = 0;
  let currentPage = 1;
  const totalPages = activeJob.pages;

  // Base duration scales with pages, modified by simulation speed
  const baseDurationMs = Math.max(1200, totalPages * 500);
  const duration = baseDurationMs / simulationSpeed;
  const stepTime = 50;
  const increment = 100 / (duration / stepTime);

  playSound("click");

  clearInterval(activePrintInterval);
  activePrintInterval = setInterval(() => {
    if (isPaused) return;

    progress += increment;

    // Calculate simulated current page
    currentPage = Math.min(totalPages, Math.floor((progress / 100) * totalPages) + 1);
    if (pageIndicator) {
      pageIndicator.innerText = `Printing Page ${currentPage} of ${totalPages}`;
    }

    if (Math.random() < 0.25) {
      playSound("step");
    }

    if (progress >= 100) {
      progress = 100;
      clearInterval(activePrintInterval);
      activePrintInterval = null;

      // Print completed
      progressBar.style.width = "100%";
      progressText.innerText = "100% Completed";
      if (pageIndicator) {
        pageIndicator.innerText = `All ${totalPages} pages printed!`;
      }

      playSound("complete");

      // Save to Archive
      const completedJob = {
        ...activeJob,
        completedAt: new Date().toLocaleTimeString()
      };
      archive.unshift(completedJob);

      // Update Telemetry
      stats.totalJobsPrinted++;
      stats.totalPagesPrinted += activeJob.pages;
      stats.totalSpoolTimeMs += duration;

      // Reset printer status after short cooling transition
      setTimeout(() => {
        isPrinting = false;
        activeJob = null;
        if (printerHardware) {
          printerHardware.classList.remove("printing-active");
        }
        progressBar.style.width = "0%";
        progressText.innerText = "0% Completed";
        if (pageIndicator) {
          pageIndicator.innerText = "Printer Ready";
        }
        printerStatusEl.innerText = "Status: IDLE";
        currentJobTextEl.innerText = "Current Job: None";

        updateUI();

        // Continue running if Auto Mode or Batch Mode still active
        checkAutoOrBatchTrigger();
      }, Math.max(300, 500 / simulationSpeed));

    } else {
      progressBar.style.width = `${progress}%`;
      progressText.innerText = `${Math.round(progress)}% Completed`;
    }
  }, stepTime);
}

// Pause / Resume Active Print
function togglePauseJob() {
  if (!isPrinting) return;
  isPaused = !isPaused;
  const pauseBtn = document.getElementById("pause-btn");
  const printerStatusEl = document.getElementById("printer-status");
  const printerHardware = document.getElementById("printer-hardware");

  playSound("click");

  if (isPaused) {
    if (pauseBtn) pauseBtn.innerText = "▶️ Resume";
    printerStatusEl.innerText = `Status: PAUSED (${activeJob ? activeJob.id : ""})`;
    if (printerHardware) {
      printerHardware.classList.remove("printing-active");
      printerHardware.classList.add("printing-paused");
    }
    showNotification("Print job paused.", "warning");
  } else {
    if (pauseBtn) pauseBtn.innerText = "⏸️ Pause";
    printerStatusEl.innerText = `Status: PRINTING (${activeJob ? activeJob.id : ""})`;
    if (printerHardware) {
      printerHardware.classList.remove("printing-paused");
      printerHardware.classList.add("printing-active");
    }
    showNotification("Print job resumed.", "info");
  }
}

// Cancel Currently Printing Job
function cancelActiveJob() {
  if (!isPrinting) return;
  playSound("click");

  clearInterval(activePrintInterval);
  activePrintInterval = null;

  const cancelledJob = activeJob;
  isPrinting = false;
  isPaused = false;
  activeJob = null;

  const progressBar = document.getElementById("progress-bar");
  const progressText = document.getElementById("progress-text");
  const pageIndicator = document.getElementById("page-indicator");
  const printerStatusEl = document.getElementById("printer-status");
  const currentJobTextEl = document.getElementById("current-job-text");
  const printerHardware = document.getElementById("printer-hardware");

  if (printerHardware) {
    printerHardware.classList.remove("printing-active", "printing-paused");
  }
  progressBar.style.width = "0%";
  progressText.innerText = "0% Completed";
  if (pageIndicator) pageIndicator.innerText = "Printer Ready";
  printerStatusEl.innerText = "Status: IDLE (Job Cancelled)";
  currentJobTextEl.innerText = "Current Job: None";

  showNotification(`Cancelled active job ${cancelledJob ? cancelledJob.id : ""}`, "danger");
  updateUI();
  checkAutoOrBatchTrigger();
}

// Remove single job from Queue
function cancelJob(jobId) {
  playSound("click");
  queue = queue.filter(job => job.id !== jobId);
  updateUI();
  showNotification(`Removed job ${jobId} from queue`, "info");
}

// Clear Entire Queue
function clearQueue() {
  if (queue.length === 0) return;
  playSound("click");
  queue = [];
  isBatchRunning = false;
  updateUI();
  showNotification("Print queue cleared.", "warning");
}

// Re-spool archived job
function respoolJob(jobId) {
  const archivedJob = archive.find(j => j.id === jobId);
  if (archivedJob) {
    const newJob = {
      ...archivedJob,
      id: `JOB-${jobIdCounter++}`,
      order: ++orderCounter,
      timestamp: new Date().toLocaleTimeString()
    };
    delete newJob.completedAt;
    enqueueJob(newJob);
    showNotification(`Re-spooled ${newJob.name} as ${newJob.id}`, "success");
  }
}

// Clear Completed Archive
function clearArchive() {
  if (archive.length === 0) return;
  playSound("click");
  archive = [];
  updateUI();
  showNotification("Archive cleared.", "info");
}

// Export Archive as CSV
function exportArchiveCSV() {
  playSound("click");
  if (archive.length === 0) {
    showNotification("No archive records to export.", "warning");
    return;
  }

  let csv = "Job ID,Document Name,Source Type,Pages,Completed At,Est Size (KB)\n";
  archive.forEach(j => {
    const cleanName = `"${(j.name || "").replace(/"/g, '""')}"`;
    csv += `${j.id},${cleanName},${j.type},${j.pages},${j.completedAt || ""},${j.sizeKb || 0}\n`;
  });

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `print_spooler_archive_${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showNotification("Archive downloaded as CSV.", "success");
}

// Filter Archive
function handleArchiveSearch(query) {
  const filter = query.toLowerCase().trim();
  renderArchive(filter);
}

// Toast Notifications
function showNotification(msg, type = "info") {
  const toastContainer = document.getElementById("toast-container");
  if (!toastContainer) return;

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;

  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("show");
  }, 10);

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 300);
  }, 2800);
}

// Render Archive Table
function renderArchive(filter = "") {
  const archiveBody = document.getElementById("archive-body");
  if (!archiveBody) return;

  let filtered = archive;
  if (filter) {
    filtered = archive.filter(j =>
      j.name.toLowerCase().includes(filter) ||
      j.id.toLowerCase().includes(filter) ||
      j.type.toLowerCase().includes(filter)
    );
  }

  if (filtered.length === 0) {
    archiveBody.innerHTML = `<tr><td colspan="6" class="text-center empty-state">${archive.length === 0 ? "No completed jobs stored in spool directory yet." : "No matching completed jobs found."
      }</td></tr>`;
  } else {
    archiveBody.innerHTML = filtered
      .map(
        (job) => `
      <tr>
        <td><span class="mono-badge">${job.id}</span></td>
        <td><strong>${escapeHtml(job.name)}</strong></td>
        <td><span class="type-badge type-${job.type.toLowerCase()}">${job.type}</span></td>
        <td>${job.pages} ${job.pages === 1 ? "page" : "pages"}</td>
        <td>${job.completedAt || "Completed"}</td>
        <td>
          <button class="btn btn-sm btn-outline" onclick="respoolJob('${job.id}')" title="Re-queue this job">🔁 Re-Spool</button>
        </td>
      </tr>
    `
      )
      .join("");
  }
}

// Escape HTML helper
function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Update UI Elements
function updateUI() {
  // Update Queue Count badge
  const queueCountEl = document.getElementById("queue-count");
  if (queueCountEl) queueCountEl.innerText = queue.length;

  // Update Status LED and controls
  const printerStatusEl = document.getElementById("printer-status");
  const statusLed = document.getElementById("status-led");
  const processNextBtn = document.getElementById("process-next-btn");
  const pauseBtn = document.getElementById("pause-btn");
  const cancelActiveBtn = document.getElementById("cancel-active-btn");

  if (!isPrinting) {
    if (queue.length === 0) {
      if (currentMode === "auto") {
        printerStatusEl.innerText = "Status: IDLE (Auto-Waiting for Jobs)";
      } else if (currentMode === "batch") {
        printerStatusEl.innerText = `Status: IDLE (Batch Mode: ${queue.length}/3 Jobs)`;
      } else {
        printerStatusEl.innerText = "Status: IDLE";
      }
    } else {
      if (currentMode === "batch" && !isBatchRunning) {
        printerStatusEl.innerText = `Status: READY (Batch Mode: ${queue.length}/3 Jobs Queued)`;
      } else {
        printerStatusEl.innerText = `Status: READY (${queue.length} in queue)`;
      }
    }
    if (statusLed) statusLed.className = "status-led led-idle";
  } else {
    if (statusLed) statusLed.className = isPaused ? "status-led led-paused" : "status-led led-printing";
  }

  // Button States
  if (processNextBtn) {
    processNextBtn.disabled = isPrinting || queue.length === 0;
  }
  if (pauseBtn) {
    pauseBtn.disabled = !isPrinting;
    pauseBtn.innerText = isPaused ? "▶️ Resume" : "⏸️ Pause";
  }
  if (cancelActiveBtn) {
    cancelActiveBtn.disabled = !isPrinting;
  }

  // Update Telemetry Counters
  const totalJobsEl = document.getElementById("stat-jobs");
  const totalPagesEl = document.getElementById("stat-pages");
  const queuePagesEl = document.getElementById("stat-queue-pages");
  const spoolMemEl = document.getElementById("stat-spool-memory");

  const queuedPages = queue.reduce((sum, j) => sum + (j.pages || 0), 0);
  const queuedMemoryKb = queue.reduce((sum, j) => sum + (j.sizeKb || 24), 0);

  if (totalJobsEl) totalJobsEl.innerText = stats.totalJobsPrinted;
  if (totalPagesEl) totalPagesEl.innerText = stats.totalPagesPrinted;
  if (queuePagesEl) queuePagesEl.innerText = queuedPages;
  if (spoolMemEl) spoolMemEl.innerText = `${(queuedMemoryKb / 1024).toFixed(2)} MB`;

  // Render Queue Items
  const queueList = document.getElementById("queue-list");
  if (queueList) {
    if (queue.length === 0) {
      queueList.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📥</div>
          <p>Queue is empty. Select a PDF, link, or click a quick sample preset!</p>
        </div>`;
    } else {
      queueList.innerHTML = queue
        .map(
          (job, index) => `
        <div class="queue-item priority-${job.priority.toLowerCase()}">
          <div class="queue-item-drag-handle">#${index + 1}</div>
          <div class="queue-item-info">
            <strong>${escapeHtml(job.name)}</strong>
            <div class="queue-item-meta">
              <span class="mono-badge">${job.id}</span>
              <span>📄 ${job.pages} ${job.pages === 1 ? "page" : "pages"}</span>
              <span>💾 ~${job.sizeKb || 20} KB</span>
              <span>⏰ ${job.timestamp}</span>
            </div>
          </div>
          <div class="queue-item-actions">
            <span class="badge badge-${job.priority.toLowerCase()}">${job.priority}</span>
            <button class="btn-icon btn-cancel" title="Remove from queue" onclick="cancelJob('${job.id}')">✕</button>
          </div>
        </div>
      `
        )
        .join("");
    }
  }

  // Render Archive Items
  const searchInput = document.getElementById("archive-search");
  renderArchive(searchInput ? searchInput.value : "");
}

// File Drag & Drop Setup
function setupFileDropZone() {
  const dropZone = document.getElementById("file-drop-zone");
  const fileInput = document.getElementById("pdf-input");
  const dropLabel = document.getElementById("file-drop-name");

  if (!dropZone || !fileInput) return;

  ["dragenter", "dragover"].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add("dragover");
    }, false);
  });

  ["dragleave", "drop"].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove("dragover");
    }, false);
  });

  dropZone.addEventListener("drop", (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files && files.length > 0) {
      fileInput.files = files;
      if (dropLabel) dropLabel.textContent = `Selected: ${files[0].name} (${Math.round(files[0].size / 1024)} KB)`;
      showNotification(`File attached: ${files[0].name}`, "info");
    }
  });

  fileInput.addEventListener("change", () => {
    if (fileInput.files && fileInput.files.length > 0) {
      if (dropLabel) dropLabel.textContent = `Selected: ${fileInput.files[0].name} (${Math.round(fileInput.files[0].size / 1024)} KB)`;
    } else {
      if (dropLabel) dropLabel.textContent = "Click or drag & drop a PDF file here";
    }
  });
}

// Initial DOM Setup
window.addEventListener("DOMContentLoaded", () => {
  setupFileDropZone();
  updateUI();
});