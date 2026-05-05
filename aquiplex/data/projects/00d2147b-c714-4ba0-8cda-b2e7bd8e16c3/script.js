let timerInterval;
let timer = 1500; // 25 minutes in seconds
let totalSessions = 0;
let totalTime = 0;
let longestSession = 0;
let isRunning = false;

const timerDisplay = document.getElementById('timer-display');
const startButton = document.getElementById('start-button');
const stopButton = document.getElementById('stop-button');
const resetButton = document.getElementById('reset-button');
const totalSessionsDisplay = document.getElementById('total-sessions');
const totalTimeDisplay = document.getElementById('total-time');
const longestSessionDisplay = document.getElementById('longest-session');

startButton.addEventListener('click', startTimer);
stopButton.addEventListener('click', stopTimer);
resetButton.addEventListener('click', resetTimer);

function startTimer() {
    if (!isRunning) {
        isRunning = true;
        timerInterval = setInterval(updateTimer, 1000);
        startButton.disabled = true;
        stopButton.disabled = false;
    }
}

function stopTimer() {
    if (isRunning) {
        isRunning = false;
        clearInterval(timerInterval);
        startButton.disabled = false;
        stopButton.disabled = true;
    }
}

function resetTimer() {
    stopTimer();
    timer = 1500;
    timerDisplay.textContent = '25:00';
    totalSessions = 0;
    totalTime = 0;
    longestSession = 0;
    totalSessionsDisplay.textContent = '0';
    totalTimeDisplay.textContent = '00:00';
    longestSessionDisplay.textContent = '00:00';
    startButton.disabled = false;
    stopButton.disabled = true;
}

function updateTimer() {
    const minutes = Math.floor(timer / 60);
    const seconds = timer % 60;
    timerDisplay.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    timer--;
    if (timer === 0) {
        isRunning = false;
        clearInterval(timerInterval);
        startButton.disabled = false;
        stopButton.disabled = true;
        totalSessions++;
        totalTime += 1500;
        longestSession = Math.max(longestSession, 1500);
        totalSessionsDisplay.textContent = totalSessions.toString();
        const minutes = Math.floor(totalTime / 60);
        const seconds = totalTime % 60;
        totalTimeDisplay.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        longestSessionDisplay.textContent = `${Math.floor(longestSession / 60).toString().padStart(2, '0')}:${(longestSession % 60).toString().padStart(2, '0')}`;
    }
}