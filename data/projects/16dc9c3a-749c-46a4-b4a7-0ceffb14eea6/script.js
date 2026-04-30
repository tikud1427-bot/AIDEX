let websites = new Map();
let currentWebsite = new Map();
let sectionCount = 0;
let savedWebsitesCount = 0;

document.addEventListener("DOMContentLoaded", function () {
    loadSavedWebsites();
});

const saveButton = document.getElementById("save-button");
saveButton.addEventListener("click", saveWebsite);

const loadButton = document.getElementById("load-button");
loadButton.addEventListener("click", loadWebsite);

const addSectionButton = document.getElementById("add-section-button");
addSectionButton.addEventListener("click", addSection);

function saveWebsite() {
    if (currentWebsite.size > 0) {
        websites.set(`Website ${savedWebsitesCount + 1}`, currentWebsite);
        updateSavedWebsitesList(savedWebsitesCount + 1);
        savedWebsitesCount++;
        currentWebsite.clear();
    }
}

function loadWebsite() {
    const select = document.getElementById("saved-websites-list");
    const selectedWebsite = select.options[select.selectedIndex].text;
    if (selectedWebsite) {
        const key = selectedWebsite.replace("Website ", "");
        currentWebsite = websites.get(key);
        const savedWebsitesList = document.getElementById("saved-websites-list");
        savedWebsitesList.innerHTML = "";
        savedWebsitesList.setAttribute("disabled", true);
        savedWebsitesList.value = "";
        const sectionsContainer = document.getElementById("sections-container");
        sectionsContainer.innerHTML = "";
        if (currentWebsite.size > 0) {
            Object.entries(currentWebsite).forEach(([key, value]) => {
                const section = createSectionElement(value);
                sectionsContainer.appendChild(section);
            });
        }
    }
}

function createSectionElement(data) {
    const section = document.createElement("section");
    const title = document.createElement("h2");
    title.textContent = data.get("title");
    const content = document.createElement("textarea");
    content.value = data.get("content");
    section.appendChild(title);
    section.appendChild(content);
    return section;
}

function addSection() {
    const newSection = createSectionElement(currentWebsite);
    const sectionsContainer = document.getElementById("sections-container");
    sectionsContainer.appendChild(newSection);
    const newSectionTitle = newSection.querySelector("h2");
    newSectionTitle.textContent = `Section ${sectionCount + 1}`;
    newSectionTitle.setAttribute("id", `title-${sectionCount + 1}`);
    const newSectionContent = newSection.querySelector("textarea");
    newSectionContent.setAttribute("id", `content-${sectionCount + 1}`);
    currentWebsite.set(`title-${sectionCount + 1