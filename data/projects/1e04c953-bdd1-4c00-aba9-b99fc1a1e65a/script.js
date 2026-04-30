// Get all necessary elements
const gameTitle = document.getElementById('game-title');
const startButton = document.getElementById('start-button');
const gameScore = document.getElementById('game-score');
const gameLevel = document.getElementById('game-level');
const gameGrid = document.getElementById('game-grid');
const moveUpButton = document.getElementById('move-up-button');
const moveDownButton = document.getElementById('move-down-button');
const moveLeftButton = document.getElementById('move-left-button');
const moveRightButton = document.getElementById('move-right-button');
const gameCopyright = document.getElementById('game-copyright');

// Initialize game variables
let score = 0;
let level = 1;
let gridSize = 10;
let grid = [];
let playerPosition = [Math.floor(gridSize / 2), Math.floor(gridSize / 2)];

// Initialize game grid
for (let i = 0; i < gridSize; i++) {
    grid[i] = [];
    for (let j = 0; j < gridSize; j++) {
        grid[i][j] = 0;
    }
}
grid[playerPosition[0]][playerPosition[1]] = 1;

// Function to draw game grid
function drawGrid() {
    gameGrid.innerHTML = '';
    for (let i = 0; i < gridSize; i++) {
        const row = document.createElement('div');
        row.className = 'row';
        for (let j = 0; j < gridSize; j++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            if (grid[i][j] === 1) {
                cell.classList.add('player');
            }
            row.appendChild(cell);
        }
        gameGrid.appendChild(row);
    }
}

// Function to update game score and level
function updateScoreAndLevel() {
    gameScore.textContent = `Score: ${score}`;
    gameLevel.textContent = `Level: ${level}`;
}

// Function to handle player movement
function movePlayer(direction) {
    let newX = playerPosition[0];
    let newY = playerPosition[1];
    switch (direction) {
        case 'up':
            newX -= 1;
            break;
        case 'down':
            newX += 1;
            break;
        case 'left':
            newY -= 1;
            break;
        case 'right':
            newY += 1;
            break;
    }
    if (newX >= 0 && newX < gridSize && newY >= 0 && newY < gridSize && grid[newX][newY] === 0) {
        grid[playerPosition[0]][playerPosition[1]] = 0;
        grid[newX][newY] = 1;
        playerPosition = [newX, newY];
        score++;
        if (score % (level * 10) === 0) {
            level++;
            gridSize++;
            grid = [];
            for (let i = 0; i < gridSize; i++) {
                grid[i] = [];
                for (let j = 0; j < gridSize; j++) {
                    grid[i][j] = 0;
                }
            }
            grid[playerPosition[0]][playerPosition[1]] = 1;
        }
        updateScoreAndLevel();
        drawGrid();
    }
}

// Add event listeners to buttons
startButton.addEventListener('click', () => {
    startButton.disabled = true;
    moveUpButton.disabled = false;
    moveDownButton.disabled = false;
    moveLeftButton.disabled = false;
    moveRightButton.disabled = false;
    drawGrid();
});

moveUpButton.addEventListener('click', () => movePlayer('up'));
moveDownButton.addEventListener('click', () => movePlayer('down'));
moveLeftButton.addEventListener('click', () => movePlayer('left'));
moveRightButton.addEventListener('click', () => movePlayer('right'));

// Update game score and level every second
setInterval(() => {
    updateScoreAndLevel();
}, 1000);

// Draw initial game grid
drawGrid();