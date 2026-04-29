const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

let gameActive = false;
let score = 0;
let player;
const keys = {};
let animationFrameId;

const sounds = {
    start: new (window.AudioContext || window.webkitAudioContext)(),
    hit: new (window.AudioContext || window.webkitAudioContext)(),
};

sounds.start.createGain().gain.setValueAtTime(0.1, sounds.start.currentTime);
sounds.hit.createGain().gain.setValueAtTime(0.1, sounds.hit.currentTime);

function init() {
    player = {
        x: canvas.width / 2,
        y: canvas.height - 50,
        width: 30,
        height: 30,
        color: 'blue',
        speed: 5,
        update() {
            if (keys['ArrowLeft'] && this.x > 0) this.x -= this.speed;
            if (keys['ArrowRight'] && this.x < canvas.width - this.width) this.x += this.speed;
        },
        render() {
            ctx.fillStyle = this.color;
            ctx.fillRect(this.x, this.y, this.width, this.height);
        },
    };

    score = 0;
    gameActive = true;
    document.getElementById('overlay').classList.add('hidden');
    document.getElementById('start-screen').classList.add('hidden');
    animate();
}

function update() {
    if (gameActive) {
        player.update();
        score++;
    }
}

function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    player.render();
    ctx.fillStyle = 'black';
    ctx.font = '20px Arial';
    ctx.fillText(`Score: ${score}`, 10, 30);
}

function animate() {
    update();
    render();
    animationFrameId = requestAnimationFrame(animate);
}

function endGame() {
    gameActive = false;
    cancelAnimationFrame(animationFrameId);
    const overlay = document.getElementById('overlay');
    overlay.classList.remove('hidden');
    document.getElementById('finalScore').textContent = `Final Score: ${score}`;
}

document.getElementById('startButton').addEventListener('click', init);
document.getElementById('restartButton').addEventListener('click', init);
document.addEventListener('keydown', (e) => { keys[e.key] = true; });
document.addEventListener('keyup', (e) => { keys[e.key] = false; });

window.addEventListener('beforeunload', () => {
    localStorage.setItem('lastScore', score);
    localStorage.setItem('gameActive', gameActive);
});