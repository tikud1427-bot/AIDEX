// Get elements
const gameTitle = document.getElementById('game-title');
const startButton = document.getElementById('start-button');
const gameDescription = document.getElementById('game-description');
const gameScore = document.getElementById('game-score');
const pauseButton = document.getElementById('pause-button');
const restartButton = document.getElementById('restart-button');
const gameCanvas = document.getElementById('game-canvas');
const copyright = document.getElementById('game-copyright');

// Set initial game state
let score = 0;
let isGameRunning = false;
let isPaused = false;
let lastAnimationFrame = 0;

// Update game score display
function updateScore() {
    gameScore.textContent = `Score: ${score}`;
}

// Draw game canvas
function drawGame() {
    const ctx = gameCanvas.getContext('2d');
    ctx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);
    ctx.fillStyle = 'black';
    ctx.font = '24px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`Score: ${score}`, 10, 10);
}

// Handle start button click
startButton.addEventListener('click', () => {
    isGameRunning = true;
    isPaused = false;
    score = 0;
    updateScore();
    drawGame();
    lastAnimationFrame = performance.now();
    requestAnimationFrame(updateGame);
});

// Handle pause button click
pauseButton.addEventListener('click', () => {
    isPaused = !isPaused;
    if (isPaused) {
        gameDescription.textContent = 'Game paused. Click to resume.';
    } else {
        gameDescription.textContent = 'A fun mobile game where you can collect coins and power-ups.';
    }
});

// Handle restart button click
restartButton.addEventListener('click', () => {
    isGameRunning = false;
    isPaused = false;
    score = 0;
    updateScore();
    drawGame();
    gameDescription.textContent = 'A fun mobile game where you can collect coins and power-ups.';
});

// Update game state
function updateGame() {
    if (isGameRunning && !isPaused) {
        const now = performance.now();
        const deltaTime = (now - lastAnimationFrame) / 1000;
        lastAnimationFrame = now;
        score += deltaTime * 100;
        updateScore();
        drawGame();
        requestAnimationFrame(updateGame);
    }
}

// Update copyright text
copyright.textContent = `&copy; ${new Date().getFullYear()} Mobile Game`;