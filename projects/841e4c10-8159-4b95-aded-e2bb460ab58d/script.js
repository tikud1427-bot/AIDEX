const Pomodoro = {
    timerId: null,
    minutes: document.getElementById('minutes'),
    seconds: document.getElementById('seconds'),
    statusDisplay: document.getElementById('status'),
    historyList: document.getElementById('history-list'),
    workButton: document.getElementById('work-option'),
    breakButton: document.getElementById('break-option'),
    workInput: document.getElementById('work-input'),
    breakInput: document.getElementById('break-input'),
    startButton: document.getElementById('start-button'),
    resetButton: document.getElementById('reset-button'),
    toast: document.querySelector('.pomodoro-toast')
};

Pomodoro.history = JSON.parse(localStorage.getItem('pomodoro-history')) || [];

const updateTimer = (minutes, seconds) => {
    if (minutes < 0 || seconds < 0) {
        Pomodoro.statusDisplay.textContent = 'TIME\'S UP!';
        Pomodoro.startButton.disabled = true;
        return;
    }

    const displayMinutes = minutes.toString().padStart(2, '0');
    const displaySeconds = seconds.toString().padStart(2, '0');
    Pomodoro.minutes.textContent = displayMinutes;
    Pomodoro.seconds.textContent = displaySeconds;
};

const updateStatus = (status) => {
    Pomodoro.statusDisplay.textContent = status;
};

const resetTimer = () => {
    updateTimer(0, 0);
    Pomodoro.startButton.disabled = false;
    Pomodoro.toast.classList.remove('hide');
    Pomodoro.toast.classList.add('hide');
};

const updateHistory = () => {
    const historyHTML = Pomodoro.history.map((entry, index) => {
        const [minutes, seconds] = entry.split(':');
        return `<li>${minutes}:${seconds} min - ${index + 1}</li>`;
    }).join('');
    Pomodoro.historyList.innerHTML = historyHTML;
    Pomodoro.historyList.scrollTop = Pomodoro.historyList.scrollHeight;
};

const startWorkCycle = () => {
    const workMinutes = +Pomodoro.workInput.value || 25;
    updateTimer(workMinutes, 0);
    updateStatus(`WORKING: ${workMinutes} min`);
    timerId = 1000;
    let timerValue = workMinutes * 60 + timerId;
    updateStatus(timerValue);
    timerValue -= timerId;
    updateTimer(...updateValue());
    updateStatus(`SESSION: ${Pomodoro.PomodoroSession.value}`);

    function updateValue() {
        const interval = 1000;
        let value = [Math.floor((timerValue / interval) % 60), Math.floor((timerValue / interval))];

        const handleValueUpdates = () => {
            if (value[0] < 0 || value[1] < 0) return;

            value[0] = value[0] % 60;
            updateTimer(value[1], value[0]);
            timerValue -= interval;

            if (+workMinutes * 60 < timerValue) {
                return startBreakCycle();
            }
        }

        return handleValueUpdates;
    }

    return updateValue();
};

const startBreakCycle = () => {
    const breakMinutes = +Pomodoro.breakInput.value || 5;
    updateTimer(breakMinutes, 0);
    updateStatus(`BREAK: ${breakMinutes} min`);
    timerId = 1000;
    let breakTimer = breakMinutes * 60;
    updateStatus(breakTimer);
    breakTimer -= timerId;

    const handleBreakUpdates = () => {
        if (breakTimer <= 0) return resetTimer();

        breakTimer -= timerId;
        updateTimer(breakTimer, ...updateBreakValue());
        updateStatus(`SESSION: ${breakMinutes} min`);

        function updateBreakValue() {
            const interval = 1000;
            let [breakValue, minutes] = [Math.floor(breakTimer / interval), Math.floor(breakTimer / interval)];

            breakValue = breakValue % 60;
            minutes = minutes;

            return [breakValue, minutes];
        }

        return updateBreakValue();
    }

    return handleBreakUpdates();
};

const handleKeyPress = (event) => {
    if (!['Control', 'Meta', 'Alt']).includes(event.type)) return;

    if (event.type === 'keydown' && (event.ctrlKey || event.metaKey || event.altKey)) {
        const historyLength = Pomodoro.history.length;
        const newHistory = Pomodoro.history.slice(0, -1);

        if (historyLength > 1 && (event.ctrlKey || event.metaKey || event.altKey)) {
            localStorage.setItem('pomodoro-history', JSON.stringify(newHistory));
            resetTimer();
            newHistory.forEach(() => {
                const [minutes, seconds] = Pomodoro.timer.split(':').map(Number);
                startWorkCycle();
                updateTimer(minutes, seconds);
                timerId = 1000;
            });
            return startWorkCycle();
        } else if (historyLength === 1) {
            newHistory.splice(0, 1);
            localStorage.setItem('pomodoro-history', JSON.stringify(newHistory));
            resetTimer();
        } else if (event.ctrlKey || event.metaKey || event.altKey) resetTimer();
    } else {
        resetTimer();
    }
}

const init = () => {
    Pomodoro.timerId = setInterval(() => {
        startWorkCycle();
    }, 1000);

    document.addEventListener('keydown', handleKeyPress);

    Pomodoro.startButton.addEventListener('click', startWorkCycle);
    Pomodoro.resetButton.addEventListener('click', resetTimer);

    Pomodoro.history.forEach(() => {
        const [minutes, seconds] = Pomodoro.timer.split(':').map(Number);
        Pomodoro.historyList.querySelectorAll('.history-entry').length
            ? Pomodoro.historyList.querySelectorAll('.history-entry').lastElementChild.classList.add('show')
            : null;
    });
    updateHistory();
};

init();

const handleToast = () => {
    const toast = document.querySelector('.pomodoro-toast');

    if (+Pomodoro.workInput.value > 0) {
        return startBreakCycle();
    } else {
        Pomodoro.startButton.disabled = true;
        Pomodoro.toast.classList.remove('hide');
        Pomodoro.toast.classList.add('show');
        return setTimeout(() => {
            document.querySelector('.pomodoro-toast.hide').classList.remove('hide');
            if (+Pomodoro.workInput.value > 0) {
                document.querySelector('.pomodoro-toast.hide').classList.add('hide');
                return startBreakCycle();
            }
        }, 1500);
    }
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
        localStorage.setItem('pomodoro-history', JSON.stringify(Pomodoro.history));
    }
});

document.addEventListener('DOMContentLoaded', () => {
    document.querySelector('.pomodoro-toast').style.opacity = 1;
    timerId = 1000;
});

document.addEventListener('DOMContentLoaded', handleToast);
document.addEventListener('DOMContentLoaded', startWorkCycle);