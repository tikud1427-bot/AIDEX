const boardElement = document.getElementById("board");
const turnElement = document.getElementById("turn");
const statusElement = document.getElementById("status");
const restartButton = document.getElementById("restart");
const board = Array(8).fill(null).map(() => Array(8).fill(null));
const pieces = {
    p: '♟', P: '♙', r: '♜', R: '♖', n: '♞', N: '♞', b: '♝', B: '♗', q: '♛', Q: '♕', k: '♚', K: '♔'
};

let currentTurn = 'white';

function initBoard() {
    boardElement.innerHTML = '';
    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const square = document.createElement("div");
            square.className = (row + col) % 2 === 0 ? 'square white' : 'square black';
            square.dataset.row = row;
            square.dataset.col = col;
            square.addEventListener('click', onSquareClick);
            boardElement.appendChild(square);
            if (row === 1) board[row][col] = 'p';
            if (row === 6) board[row][col] = 'P';
        }
    }
    setInitialPositions();
    renderBoard();
}

function setInitialPositions() {
    const initialSetup = [
        'r', 'n', 'b', 'q', 'k', 'b', 'n', 'r',
        null, null, null, null, null, null, null, null,
        'p', 'p', 'p', 'p', 'p', 'p', 'p', 'p',
        null, null, null, null, null, null, null, null,
        null, null, null, null, null, null, null, null,
        null, null, null, null, null, null, null, null,
        'P', 'P', 'P', 'P', 'P', 'P', 'P', 'P',
        'R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'
    ];
    for (let i = 0; i < 8; i++) {
        board[0][i] = initialSetup[i].toLowerCase();
        board[7][i] = initialSetup[i].toUpperCase();
    }
}

function renderBoard() {
    const squares = document.querySelectorAll('.square');
    squares.forEach(square => {
        const row = square.dataset.row;
        const col = square.dataset.col;
        square.textContent = board[row][col] ? pieces[board[row][col]] : '';
    });
    turnElement.textContent = `Current turn: ${currentTurn.charAt(0).toUpperCase() + currentTurn.slice(1)}`;
}

let selectedSquare = null;

function onSquareClick(event) {
    const square = event.target;
    const row = square.dataset.row;
    const col = square.dataset.col;
    
    if (selectedSquare) {
        const prevRow = selectedSquare.dataset.row;
        const prevCol = selectedSquare.dataset.col;
        const piece = board[prevRow][prevCol];
        
        if(piece && ((currentTurn === 'white' && piece === piece.toUpperCase()) || (currentTurn === 'black' && piece === piece.toLowerCase()))) {
            movePiece(prevRow, prevCol, row, col);
            selectedSquare.classList.remove('selected');
            selectedSquare = null;
            if (currentTurn === 'white') {
                currentTurn = 'black';
            } else {
                currentTurn = 'white';
            }
        } else {
            alert("It's not your turn or there's no piece to move");
            selectedSquare.classList.remove('selected');
            selectedSquare = null;
        }
    } else {
        if (board[row][col] && ((currentTurn === 'white' && board[row][col] === board[row][col].toUpperCase()) || (currentTurn === 'black' && board[row][col] === board[row][col].toLowerCase()))) {
            selectedSquare = square;
            selectedSquare.classList.add('selected');
        }
    }
    renderBoard();
}

function movePiece(prevRow, prevCol, newRow, newCol) {
    board[newRow][newCol] = board[prevRow][prevCol];
    board[prevRow][prevCol] = null;
    statusElement.textContent = '';
}

restartButton.addEventListener('click', () => {
    currentTurn = 'white';
    initBoard();
});

initBoard();