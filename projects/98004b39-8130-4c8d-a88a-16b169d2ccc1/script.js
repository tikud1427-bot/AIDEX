const canvas = document.getElementById('chessBoard');
const ctx = canvas.getContext('2d');
const boardSize = 8;
const tileSize = canvas.width / boardSize;
let board = [];
let turn = 'white';
let selectedPiece = null;
let gameState = 'playing';

const pieces = {
    white: {
        king: { position: { x: 4, y: 0 }, img: 'data:image/png;base64,...' },
        queen: { position: { x: 3, y: 0 }, img: 'data:image/png;base64,...' },
        rooks: [{ position: { x: 0, y: 0 }, img: 'data:image/png;base64,...' }, { position: { x: 7, y: 0 }, img: 'data:image/png;base64,...' }],
        knights: [{ position: { x: 1, y: 0 }, img: 'data:image/png;base64,...' }, { position: { x: 6, y: 0 }, img: 'data:image/png;base64,...' }],
        bishops: [{ position: { x: 2, y: 0 }, img: 'data:image/png;base64,...' }, { position: { x: 5, y: 0 }, img: 'data:image/png;base64,...' }],
        pawns: Array.from({ length: 8 }, (_, i) => ({ position: { x: i, y: 1 }, img: 'data:image/png;base64,...' }))
    },
    black: {
        king: { position: { x: 4, y: 7 }, img: 'data:image/png;base64,...' },
        queen: { position: { x: 3, y: 7 }, img: 'data:image/png;base64,...' },
        rooks: [{ position: { x: 0, y: 7 }, img: 'data:image/png;base64,...' }, { position: { x: 7, y: 7 }, img: 'data:image/png;base64,...' }],
        knights: [{ position: { x: 1, y: 7 }, img: 'data:image/png;base64,...' }, { position: { x: 6, y: 7 }, img: 'data:image/png;base64,...' }],
        bishops: [{ position: { x: 2, y: 7 }, img: 'data:image/png;base64,...' }, { position: { x: 5, y: 7 }, img: 'data:image/png;base64,...' }],
        pawns: Array.from({ length: 8 }, (_, i) => ({ position: { x: i, y: 6 }, img: 'data:image/png;base64,...' }))
    }
};

function init() {
    drawBoard();
    drawPieces();
    document.getElementById('restartBtn').addEventListener('click', resetGame);
    canvas.addEventListener('click', onCanvasClick);
}

function drawBoard() {
    for (let row = 0; row < boardSize; row++) {
        for (let col = 0; col < boardSize; col++) {
            ctx.fillStyle = (row + col) % 2 === 0 ? '#EEE' : '#555';
            ctx.fillRect(col * tileSize, row * tileSize, tileSize, tileSize);
        }
    }
}

function drawPieces() {
    for (const color in pieces) {
        for (const type in pieces[color]) {
            const piece = pieces[color][type];
            const { x, y } = piece.position;
            const img = new Image();
            img.src = piece.img;
            img.onload = () => {
                ctx.drawImage(img, x * tileSize, y * tileSize, tileSize, tileSize);
            };
        }
    }
}

function onCanvasClick(event) {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) / tileSize);
    const y = Math.floor((event.clientY - rect.top) / tileSize);
    handlePieceSelection(x, y);
}

function handlePieceSelection(x, y) {
    const currentPiece = findPieceAt(x, y);

    if (selectedPiece) {
        if (validMove(selectedPiece, { x, y })) {
            movePiece(selectedPiece, { x, y });
            turn = turn === 'white' ? 'black' : 'white';
        }
        selectedPiece = null;
    } else if (currentPiece && currentPiece.color === turn) {
        selectedPiece = currentPiece;
    }

    drawBoard();
    drawPieces();
}

function findPieceAt(x, y) {
    for (const color in pieces) {
        for (const type in pieces[color]) {
            const piece = pieces[color][type];
            if (piece.position.x === x && piece.position.y === y) {
                return { ...piece, color };
            }
        }
    }
    return null;
}

function validMove(piece, newPosition) {
    // Basic movement validation logic
    return true; // Placeholder for actual movement logic
}

function movePiece(piece, newPosition) {
    piece.position = newPosition;
}

function resetGame() {
    // Reset logic implementation
    pieces.white = {...}; // Reset white pieces
    pieces.black = {...}; // Reset black pieces
    turn = 'white';
    drawBoard();
    drawPieces();
}

init();