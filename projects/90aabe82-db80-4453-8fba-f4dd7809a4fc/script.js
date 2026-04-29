const toolListElement = document.getElementById('toolList');
const addToolButton = document.getElementById('addToolButton');
const searchBar = document.getElementById('searchBar');

let tools = JSON.parse(localStorage.getItem('aiTools')) || [];

const renderTools = (filter = '') => {
    toolListElement.innerHTML = '';
    const filteredTools = tools.filter(tool => tool.name.toLowerCase().includes(filter.toLowerCase()));
    filteredTools.forEach(tool => {
        const li = document.createElement('li');
        li.textContent = `${tool.name}: ${tool.description}`;
        toolListElement.appendChild(li);
    });
};

const addTool = () => {
    const toolName = document.getElementById('toolName').value;
    const toolDescription = document.getElementById('toolDescription').value;
    
    if (toolName && toolDescription) {
        tools.push({ name: toolName, description: toolDescription });
        localStorage.setItem('aiTools', JSON.stringify(tools));
        document.getElementById('toolName').value = '';
        document.getElementById('toolDescription').value = '';
        renderTools();
    }
};

addToolButton.addEventListener('click', addTool);
searchBar.addEventListener('input', (e) => renderTools(e.target.value));

renderTools();