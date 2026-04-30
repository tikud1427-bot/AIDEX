const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const startButton = document.getElementById('startButton');
const restartButton = document.getElementById('restartButton');

const gameOverScreen = document.getElementById('gameOver');
const startScreen = document.getElementById('startScreen');

const finalScoreDisplay = document.getElementById('finalScore');
const liveScoreDisplay = document.getElementById('liveScore');

/* ✅ FIX BLUR (HD scaling) */
const dpr = window.devicePixelRatio || 1;
const width = 400;
const height = 600;

canvas.width = width * dpr;
canvas.height = height * dpr;
canvas.style.width = width + "px";
canvas.style.height = height + "px";

ctx.scale(dpr, dpr);
ctx.imageSmoothingEnabled = false;

/* GAME STATE */
let player;
let blocks = [];
let keys = {};
let score = 0;
let spawnRate = 1000;
let gameInterval;
let isGameActive = false;

/* PLAYER */
class Player {
    constructor() {
        this.width = 50;
        this.height = 15;
        this.x = width / 2 - this.width / 2;
        this.y = height - 40;
        this.speed = 6;
    }

    update() {
        if (keys['ArrowLeft']) this.x -= this.speed;
        if (keys['ArrowRight']) this.x += this.speed;

        this.x = Math.max(0, Math.min(width - this.width, this.x));
    }

    draw() {
        ctx.fillStyle = '#61dafb';
        ctx.shadowBlur = 15;
        ctx.shadowColor = '#61dafb';
        ctx.fillRect(this.x, this.y, this.width, this.height);
        ctx.shadowBlur = 0;
    }
}

/* BLOCK */
class Block {
    constructor() {
        this.width = 40;
        this.height = 20;
        this.x = Math.random() * (width - this.width);
        this.y = -20;
        this.speed = 2 + Math.random() * 2 + score * 0.05;
    }

    update() {
        this.y += this.speed;

        if (this.y > height) {
            score++;
            blocks.splice(blocks.indexOf(this), 1);
        }
    }

    draw() {
        ctx.fillStyle = '#ff4d4d';
        ctx.shadowBlur = 10;
        ctx.shadowColor = '#ff4d4d';
        ctx.fillRect(this.x, this.y, this.width, this.height);
        ctx.shadowBlur = 0;
    }

    collide(player) {
        return (
            this.x < player.x + player.width &&
            this.x + this.width > player.x &&
            this.y < player.y + player.height &&
            this.y + this.height > player.y
        );
    }
}

/* GAME CONTROL */
function startGame() {
    score = 0;
    blocks = [];
    player = new Player();
    spawnRate = 1000;

    isGameActive = true;

    startScreen.classList.add('hidden');
    gameOverScreen.classList.add('hidden');

    gameInterval = setInterval(spawnBlock, spawnRate);

    requestAnimationFrame(gameLoop);
}

function endGame() {
    isGameActive = false;
    clearInterval(gameInterval);

    finalScoreDisplay.textContent = score;
    gameOverScreen.classList.remove('hidden');
}

function spawnBlock() {
    blocks.push(new Block());

    if (spawnRate > 400) {
        spawnRate -= 10;
        clearInterval(gameInterval);
        gameInterval = setInterval(spawnBlock, spawnRate);
    }
}

/* UPDATE */
function update() {
    player.update();

    blocks.forEach(block => {
        block.update();

        if (block.collide(player)) {
            endGame();
        }
    });

    blocks = blocks.filter(b => b.y < height);

    liveScoreDisplay.textContent = score;
}

/* RENDER */
function render() {
    ctx.clearRect(0, 0, width, height);

    player.draw();
    blocks.forEach(b => b.draw());
}

/* LOOP */
function gameLoop() {
    if (!isGameActive) return;

    update();
    render();

    requestAnimationFrame(gameLoop);
}

/* INPUT */
document.addEventListener('keydown', e => {
    keys[e.key] = true;
});

document.addEventListener('keyup', e => {
    keys[e.key] = false;
});

/* BUTTONS */
startButton.addEventListener('click', startGame);
restartButton.addEventListener('click', startGame);