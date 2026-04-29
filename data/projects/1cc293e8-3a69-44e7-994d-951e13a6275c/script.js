let gameBoard = Array(9).fill('');
let currentPlayer = 'X';
let score = { X: 0, O: 0 };
let sound;
let lives = 10;
let isGameStarted = false;

document.addEventListener('touchstart', () => {
    lives = 10;
});

sound = new Audio();
sound.src = 'data:audio/wav;base64,UklGRkIACAAALQACAAIBAAACHQAhABIAAIAAAAIQABAAIAAAFABgABAAAAfgAAABgABAAAAfgAAABIAAAIAAAAGABgABAAAAfgAAAAMABAAAAFQAACgABAAAAGgAAAACQABAAIAAAAGABIAAAAAGgAAABIAAAIAAAAGADAAAABgAAAAAAgBQACAAIAAAA4AABQABAAA2wA=';

const init = () => {
    document.getElementById('score-display').textContent = `Score - X: ${score.X} | O: ${score.O}`;
    document.getElementById('game-status').textContent = 'New Game Started!';
    document.getElementById('game-board').textContent = '';
    gameBoard.fill('');
    Array.from(document.querySelectorAll('.square')).forEach((square) => {
        square.addEventListener('click', selectSquare);
        square.addEventListener('touchstart', selectSquare);
        square.addEventListener('mouseover', () => {
            square.style.backgroundColor = '#e6e7e8';
        });
        square.addEventListener('mouseout', () => {
            square.style.backgroundColor = '#ffffff';
        });
    });
    document.getElementById('reset-button').addEventListener('click', resetGame);
};

const selectSquare = (e) => {
    if (isGameStarted && lives > 0) {
        const square = e.target;
        const index = parseInt(square.id.split('-')[1]);
        if (gameBoard[index] === '') {
            gameBoard[index] = currentPlayer;
            square.textContent = currentPlayer;
            if (checkWin()) {
                sound.currentTime = 0;
                sound.play();
                document.getElementById('game-status').textContent = `Player ${currentPlayer} wins!`;
                lives = 0;
                setTimeout(() => {
                    currentPlayer = 'X';
                    score[currentPlayer] += 1;
                    document.getElementById('score-display').textContent = `Score - X: ${score.X} | O: ${score.O}`;
                    gameBoard.fill('');
                    Array.from(document.querySelectorAll('.square')).forEach((square) => {
                        square.textContent = '';
                    });
                }, 2000);
            } else if (checkDraw()) {
                sound.currentTime = 0;
                sound.play();
                document.getElementById('game-status').textContent = 'It\'s a draw!';
                lives = 0;
                setTimeout(() => {
                    currentPlayer = 'X';
                    score[currentPlayer === 'X' ? 'O' : 'X'] += 1;
                    document.getElementById('score-display').textContent = `Score - X: ${score.X} | O: ${score.O}`;
                    gameBoard.fill('');
                    Array.from(document.querySelectorAll('.square')).forEach((square) => {
                        square.textContent = '';
                    });
                }, 2000);
            } else {
                currentPlayer = currentPlayer === 'X' ? 'O' : 'X';
                document.getElementById('game-status').textContent = `Player ${currentPlayer}'s turn`;
            }
            square.style.backgroundColor = '#66cc00';
            setTimeout(() => {
                square.style.backgroundColor = '#e6e7e8';
            }, 200);
        }
    }
};

const checkWin = () => {
    const winConditions = [
        [0, 1, 2],
        [3, 4, 5],
        [6, 7, 8],
        [0, 3, 6],
        [1, 4, 7],
        [2, 5, 8],
        [0, 4, 8],
        [2, 4, 6]
    ];
    for (const condition of winConditions) {
        if (gameBoard[condition[0]] !== '' && gameBoard[condition[0]] === gameBoard[condition[1]] && gameBoard[condition[0]] === gameBoard[condition[2]]) {
            return true;
        }
    }
    return false;
};

const checkDraw = () => {
    return !gameBoard.includes('');
};

const resetGame = () => {
    lives = 10;
    isGameStarted = false;
    score = { X: 0, O: 0 };
    sound.currentTime = 0;
    sound.play();
    document.getElementById('score-display').textContent = `Score - X: ${score.X} | O: ${score.O}`;
    document.getElementById('game-status').textContent = 'New Game Started!';
    document.getElementById('game-board').textContent = '';
    gameBoard = Array(9).fill('');
    Array.from(document.querySelectorAll('.square')).forEach((square) => {
        square.removeEventListener('click', selectSquare);
        square.removeEventListener('touchstart', selectSquare);
        square.textContent = '';
        square.style.backgroundColor = '#ffffff';
    });
    init();
};

document.getElementById('play-button').addEventListener('click', () => {
    isGameStarted = true;
    init();
});

init();