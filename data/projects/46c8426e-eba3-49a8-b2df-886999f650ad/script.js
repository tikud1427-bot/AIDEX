let display = document.getElementById('display');
let clearButton = document.getElementById('clear');
let backspaceButton = document.getElementById('backspace');
let divideButton = document.getElementById('divide');
let multiplyButton = document.getElementById('multiply');
let sevenButton = document.getElementById('seven');
let eightButton = document.getElementById('eight');
let nineButton = document.getElementById('nine');
let subtractButton = document.getElementById('subtract');
let fourButton = document.getElementById('four');
let fiveButton = document.getElementById('five');
let sixButton = document.getElementById('six');
let addButton = document.getElementById('add');
let oneButton = document.getElementById('one');
let twoButton = document.getElementById('two');
let threeButton = document.getElementById('three');
let equalsButton = document.getElementById('equals');
let zeroButton = document.getElementById('zero');
let decimalButton = document.getElementById('decimal');

let currentNumber = '0';
let previousNumber = '';
let operation = '';

clearButton.addEventListener('click', () => {
    currentNumber = '0';
    previousNumber = '';
    operation = '';
    display.textContent = '0';
});

backspaceButton.addEventListener('click', () => {
    currentNumber = currentNumber.slice(0, -1);
    if (currentNumber === '') {
        currentNumber = '0';
    }
    display.textContent = currentNumber;
});

sevenButton.addEventListener('click', () => {
    if (currentNumber === '0') {
        currentNumber = '7';
    } else {
        currentNumber += '7';
    }
    display.textContent = currentNumber;
});

eightButton.addEventListener('click', () => {
    if (currentNumber === '0') {
        currentNumber = '8';
    } else {
        currentNumber += '8';
    }
    display.textContent = currentNumber;
});

nineButton.addEventListener('click', () => {
    if (currentNumber === '0') {
        currentNumber = '9';
    } else {
        currentNumber += '9';
    }
    display.textContent = currentNumber;
});

fourButton.addEventListener('click', () => {
    if (currentNumber === '0') {
        currentNumber = '4';
    } else {
        currentNumber += '4';
    }
    display.textContent = currentNumber;
});

fiveButton.addEventListener('click', () => {
    if (currentNumber === '0') {
        currentNumber = '5';
    } else {
        currentNumber += '5';
    }
    display.textContent = currentNumber;
});

sixButton.addEventListener('click', () => {
    if (currentNumber === '0') {
        currentNumber = '6';
    } else {
        currentNumber += '6';
    }
    display.textContent = currentNumber;
});

oneButton.addEventListener('click', () => {
    if (currentNumber === '0') {
        currentNumber = '1';
    } else {
        currentNumber += '1';
    }
    display.textContent = currentNumber;
});

twoButton.addEventListener('click', () => {
    if (currentNumber === '0') {
        currentNumber = '2';
    } else {
        currentNumber += '2';
    }
    display.textContent = currentNumber;
});

threeButton.addEventListener('click', () => {
    if (currentNumber === '0') {
        currentNumber = '3';
    } else {
        currentNumber += '3';
    }
    display.textContent = currentNumber;
});

zeroButton.addEventListener('click', () => {
    if (currentNumber === '0') {
        currentNumber = '0';
    } else {
        currentNumber += '0';
    }
    display.textContent = currentNumber;
});

decimalButton.addEventListener('click', () => {
    if (!currentNumber.includes('.')) {
        currentNumber += '.';
    }
    display.textContent = currentNumber;
});

divideButton.addEventListener('click', () => {
    previousNumber = currentNumber;
    currentNumber = '';
    operation = 'divide';
    display.textContent = '';
});

multiplyButton.addEventListener('click', () => {
    previousNumber = currentNumber;
    currentNumber = '';
    operation = 'multiply';
    display.textContent = '';
});

subtractButton.addEventListener('click', () => {
    previousNumber = currentNumber;
    currentNumber = '';
    operation = 'subtract';
    display.textContent = '';
});

addButton.addEventListener('click', () => {
    previousNumber = currentNumber;
    currentNumber = '';
    operation = 'add';
    display.textContent = '';
});

equalsButton.addEventListener('click', () => {
    let result;
    switch (operation) {
        case 'divide':
            result = parseFloat(previousNumber) / parseFloat(currentNumber);
            break;
        case 'multiply':
            result = parseFloat(previousNumber) * parseFloat(currentNumber);
            break;
        case 'subtract':
            result = parseFloat(previousNumber) - parseFloat(currentNumber);
            break;
        case 'add':
            result = parseFloat(previousNumber) + parseFloat(currentNumber);
            break;
    }
    display.textContent = result.toString();
    currentNumber = result.toString();
    previousNumber = '';
    operation = '';
});