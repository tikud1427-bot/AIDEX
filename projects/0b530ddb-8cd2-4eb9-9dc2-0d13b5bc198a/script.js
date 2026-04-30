let intervalId = null;
let timer = 1500;
let sessionLength = 25;
let breakLength = 5;
let running = false;
let history = [];

function updateTimer() {
    const minutes = Math.floor(timer / 60);
    const seconds = timer % 60;
    document.getElementById('timer').textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    timer--;
    if (timer < 0) {
        if (running) {
            endSession();
        } else {
            startBreak();
        }
    }
}

function startSession() {
    intervalId = setInterval(updateTimer, 1000);
    document.getElementById('start-button').disabled = true;
    document.getElementById('stop-button').disabled = false;
}

function endSession() {
    history.push(sessionLength);
    document.getElementById('history-list').insertAdjacentHTML('beforeend', `<li>Session: ${sessionLength} minutes</li>`);
    document.getElementById('timer').textContent = '00:00';
    timer = sessionLength * 60;
    running = false;
    document.getElementById('start-button').disabled = false;
    document.getElementById('stop-button').disabled = true;
}

function startBreak() {
    history.push(breakLength);
    document.getElementById('history-list').insertAdjacentHTML('beforeend', `<li>Break: ${breakLength} minutes</li>`);
    document.getElementById('timer').textContent = '00:00';
    timer = breakLength * 60;
    document.getElementById('start-button').disabled = false;
    document.getElementById('stop-button').disabled = true;
    running = false;
    document.getElementById('timer-container').style.backgroundColor = '#ccffcc';
    setTimeout(() => {
        document.getElementById('timer-container').style.backgroundColor = '';
    }, 1000);
}

function reset() {
    clearInterval(intervalId);
    intervalId = null;
    timer = 0;
    document.getElementById('timer').textContent = '00:00';
    document.getElementById('start-button').disabled = true;
    document.getElementById('stop-button').disabled = true;
    document.getElementById('reset-button').disabled = false;
    running = false;
    document.getElementById('history-list').innerHTML = '';
    localStorage.setItem('pomodoroHistory', JSON.stringify(history));
}

document.getElementById('start-button').addEventListener('click', function() {
    running = true;
    startSession();
});

document.getElementById('stop-button').addEventListener('click', function() {
    running = false;
    clearInterval(intervalId);
    intervalId = null;
    document.getElementById('start-button').disabled = false;
    document.getElementById('stop-button').disabled = true;
});

document.getElementById