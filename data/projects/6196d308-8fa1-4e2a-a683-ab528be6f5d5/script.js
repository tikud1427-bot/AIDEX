const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const startButton = document.getElementById('startButton');
const restartButton = document.getElementById('restartButton');
const overlay = document.getElementById('overlay');
const finalScore = document.getElementById('finalScore');
const startScreen = document.getElementById('start-screen');

let gameInterval;
let score = 0;

startButton.addEventListener('click', startGame);
restartButton.addEventListener('click', restartGame);

function startGame() {
    score = 0;
    startScreen.classList.add('hidden');
    overlay.classList.add('hidden');
    gameInterval = setInterval(updateGame, 1000 / 60);
}

function restartGame() {
    score = 0;
    startScreen.classList.remove('hidden');
    overlay.classList.add('hidden');
    clearInterval(gameInterval);
}

function updateGame() {
    // Placeholder for game update logic
    score++;
    if (score >= 100) {
        endGame();
    }
}

function endGame() {
    clearInterval(gameInterval);
    finalScore.innerText = `Final Score: ${score}`;
    overlay.classList.remove('hidden');
}