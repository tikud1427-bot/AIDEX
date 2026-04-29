document.addEventListener('DOMContentLoaded', () => {
    const noteInput = document.getElementById('noteInput');
    const generateBtn = document.getElementById('generateBtn');
    const clearBtn = document.getElementById('clearBtn');
    const copyBtn = document.getElementById('copyBtn');
    const shortNoteContainer = document.getElementById('shortNoteContainer');
    const errorMessage = document.getElementById('errorMessage');

    generateBtn.addEventListener('click', generateShortNote);
    clearBtn.addEventListener('click', clearAllNotes);
    copyBtn.addEventListener('click', copyToClipboard);

    // Keyboard shortcuts
    document.addEventListener('keydown', (event) => {
        if (event.ctrlKey && event.key === 'Enter') {
            generateShortNote();
        }
        if (event.ctrlKey && event.key === 'c') {
            copyToClipboard();
        }
        if (event.ctrlKey && event.key === 'x') {
            clearAllNotes();
        }
    });

    function generateShortNote() {
        const noteText = noteInput.value.trim();
        if (noteText === "") {
            displayError("Please enter a note.");
            return;
        }

        const shortNote = noteText.length > 100 ? noteText.slice(0, 100) + '...' : noteText;
        shortNoteContainer.textContent = shortNote;
        localStorage.setItem('shortNote', shortNote);
        noteInput.value = "";
        errorMessage.style.display = 'none';
    }

    function clearAllNotes() {
        noteInput.value = "";
        shortNoteContainer.textContent = "";
        localStorage.removeItem('shortNote');
        errorMessage.style.display = 'none';
    }

    function copyToClipboard() {
        const shortNote = shortNoteContainer.textContent;
        if (shortNote) {
            navigator.clipboard.writeText(shortNote)
                .then(() => {
                    alert("Note copied to clipboard!");
                })
                .catch(err => {
                    alert("Failed to copy note: " + err);
                });
        } else {
            displayError("No short note to copy.");
        }
    }

    function displayError(message) {
        errorMessage.textContent = message;
        errorMessage.style.display = 'block';
    }
});