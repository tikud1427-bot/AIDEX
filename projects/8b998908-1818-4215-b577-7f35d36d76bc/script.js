let focusTime = 25 * 60 * 1000;
let breakTime = 5 * 60 * 1000;
let numCycles = 4;

let currentCycle = 0;
let currentTask = "";
let timerRunning = false;
let pauseTime = 0;

const timeLeftDisplay = document.getElementById("time-left");
const timerStatusDisplay = document.getElementById("timer-status");
const timeLeftRemainingDisplay = document.getElementById("time-left-remaining");
const timeGraphicCanvas = document.getElementById("timer-graphic");

function timerGraphic() {
  const ctx = timeGraphicCanvas.getContext("2d");
  ctx.clearRect(0, 0, timeGraphicCanvas.width, timeGraphicCanvas.height);
  ctx.beginPath();
  ctx.arc(timeGraphicCanvas.width / 2, timeGraphicCanvas.height / 2, timeGraphicCanvas.width / 2 - 10, 0, Math.PI * 2);
  ctx.fillStyle = "#000";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(timeGraphicCanvas.width / 2, timeGraphicCanvas.height / 2, timeGraphicCanvas.width / 2 - 20, 0, Math.PI * 2);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#ccc";
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(timeGraphicCanvas.width / 2, timeGraphicCanvas.height / 2, timeGraphicCanvas.width / 2 - 30, 0, Math.PI * 2);
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#f00";
  ctx.stroke();
}

function updateTimerDisplay() {
  if (timerRunning) {
    const currentTime = document.getElementById("time-left");
    const seconds = Math.floor((focusTime - (Date.now() - pauseTime)) / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    currentTime.textContent = `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
}

function updateStatusDisplay() {
  if (timerRunning) {
    const startTime = new Date(pauseTime);
    const elapsed = Date.now() - startTime;
    const remaining = focusTime - elapsed;
    const percentageCompleted = remaining / focusTime;
    const progressText = `${elapsed / 1000} seconds elapsed, ${remaining / 1000} seconds remaining, ${percentageCompleted * 100}% complete`;
    const cycleText = `Cycle: ${currentCycle + 1} of ${numCycles} with task "${currentTask}"`;
    timerStatusDisplay.textContent = progressText;
    timeLeftRemainingDisplay.textContent = cycleText;
  } else {
    timerStatusDisplay.textContent = "Time: 00:00:00, Started: false";
  }
}

let intervalId = setInterval(() => {
  updateTimerDisplay();
  updateStatusDisplay();
  timerGraphic();
}, 100);

function saveSettings() {
  focusTime = parseInt(document.getElementById("focus-time").value) * 60 * 1000;
  breakTime = parseInt(document.getElementById("break-time").value) * 60 * 1000;
  numCycles = parseInt(document.getElementById("num-cycles").value);
}

function startTimer() {
  if (!timerRunning) {
    saveSettings();
    currentCycle = 0;
    currentTask = "Task 1";
    timerRunning = true;
    pauseTime = Date.now();
    timeLeftDisplay.textContent = "00:00:00";
  }
}

function restartTimer() {
  timerRunning = false;
  pauseTime = 0;
  currentCycle = 0;
  currentTask = "Task 1";
  timeLeftDisplay.textContent = "00:00:00";
}

function pauseTimer() {
  if (timerRunning) {
    timerRunning = false;
    pauseTime = Date.now() - (Date.now() - pauseTime);
  }
}

function stopTimer() {
  timerRunning = false;
  pauseTime = 0;
}

document.getElementById("start-timer").addEventListener("click", startTimer);
document.getElementById("restart-timer").addEventListener("click", restartTimer);
document.getElementById("pause-timer").addEventListener("click", pauseTimer);
document.getElementById("stop-timer").addEventListener("click", stopTimer);

saveSettings();

setInterval(() => {
  if (focusTime - (Date.now() - pauseTime) <= 0) {
    pauseTimer();
    const nextCycle = currentCycle + 1;
    const isLastCycle = nextCycle > numCycles;
    if (isLastCycle) {
      // Add code for the last cycle here
    } else {
      currentCycle = nextCycle;
      saveSettings();
      currentTask = "Task 2";
      focusTime = breakTime;
    }
    updateTimerDisplay();
    updateStatusDisplay();
  }
}, 1000);

const audioContext = new AudioContext();
const focusSound = new Audio(`data:audio/wav;base64,RAAAAAAMDAgAAAAAAAABAAABgCAAAABAAAAAQAAABoCAAAABAAAAABwCAAAABAAAAAC8BAAAAAgAAAAEAAAAUAAAABAAAAAB8BAABAAAAAAAABAAAAAQAAABoCAAAABAAAAABwCAAAABAAAAAC8BAAAAAgAAAAEAAAAQAAAACAAAAAB8BAAAAAgAAAAEAAAAQAAAABAAAAAB8BAABAAAAAAAABAAAAAQAAABoCAAAABAAAAABwCAAAABAAAAAC8BAAAAAgAAAAEAAAAU