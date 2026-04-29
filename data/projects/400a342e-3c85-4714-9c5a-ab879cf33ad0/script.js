const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const startScreen = document.getElementById('startScreen');
const gameOverScreen = document.getElementById('gameOverScreen');
const finalScore = document.getElementById('finalScore');
const restartButton = document.getElementById('restartButton');

canvas.width = 800;
canvas.height = 600;

let player, enemies, stars, score, lives, gameOver;

document.addEventListener('keydown', handleKeyPress);
restartButton.addEventListener('click', restartGame);

function init() {
    player = { x: canvas.width / 2, y: canvas.height - 50, width: 30, height: 30, color: 'blue' };
    enemies = [];
    stars = [];
    score = 0;
    lives = 3;
    gameOver = false;
    generateEnemies();
    generateStars();
    startScreen.classList.add('hidden');
    requestAnimationFrame(gameLoop);
}

function generateEnemies() {
    for (let i = 0; i < 5; i++) {
        enemies.push({ x: Math.random() * (canvas.width - 30), y: Math.random() * (canvas.height - 200), width: 30, height: 30, color: 'red' });
    }
}

function generateStars() {
    for (let i = 0; i < 5; i++) {
        stars.push({ x: Math.random() * (canvas.width - 10), y: Math.random() * (canvas.height - 50), width: 10, height: 10, color: 'yellow' });
    }
}

function handleKeyPress(event) {
    if (event.code === 'Enter' && gameOver) {
        restartGame();
    }
    if (!gameOver) {
        if (event.code === 'ArrowLeft') player.x -= 15;
        if (event.code === 'ArrowRight') player.x += 15;
    }
}

function update() {
    enemies.forEach(enemy => {
        enemy.y += 2;
        if (enemy.y > canvas.height) {
            enemy.y = 0;
            enemy.x = Math.random() * (canvas.width - 30);
        }
        if (collision(player, enemy)) {
            lives--;
            if (lives <= 0) {
                gameOver = true;
            }
        }
    });

    stars.forEach((star, index) => {
        if (collision(player, star)) {
            score++;
            stars.splice(index, 1);
            generateStar();
        }
    });
}

function collision(rect1, rect2) {
    return rect1.x < rect2.x + rect2.width &&
           rect1.x + rect1.width > rect2.x &&
           rect1.y < rect2.y + rect2.height &&
           rect1.y + rect1.height > rect2.y;
}

function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = player.color;
    ctx.fillRect(player.x, player.y, player.width, player.height);

    enemies.forEach(enemy => {
        ctx.fillStyle = enemy.color;
        ctx.fillRect(enemy.x, enemy.y, enemy.width, enemy.height);
    });

    stars.forEach(star => {
        ctx.fillStyle = star.color;
        ctx.fillRect(star.x, star.y, star.width, star.height);
    });

    ctx.fillStyle = 'black';
    ctx.fillText(`Score: ${score}`, 10, 20);
    ctx.fillText(`Lives: ${lives}`, canvas.width - 100, 20);

    if (gameOver) {
        gameOverScreen.classList.remove('hidden');
        finalScore.textContent = score;
    }
}

function gameLoop() {
    if (!gameOver) {
        update();
        render();
        requestAnimationFrame(gameLoop);
    }
}

function generateStar() {
    stars.push({ x: Math.random() * (canvas.width - 10), y: Math.random() * (canvas.height - 50), width: 10, height: 10, color: 'yellow' });
}

function restartGame() {
    startScreen.classList.add('hidden');
    gameOverScreen.classList.add('hidden');
    init();
}

init();