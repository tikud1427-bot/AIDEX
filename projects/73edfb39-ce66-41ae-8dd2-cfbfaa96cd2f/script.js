const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');
const directoryList = document.getElementById('directory-list');
const moreInfoBtns = document.querySelectorAll('.more-info-btn');
const moreInfoContainers = document.querySelectorAll('.more-info-container');

searchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const searchQuery = searchInput.value.toLowerCase();
  directoryList.innerHTML = '';
  const directoryEntries = [
    { heading: 'Organization XYZ', text: 'A leading AI research institution with a focus on computer vision.', moreInfo: 'Organization XYZ is a non-profit research institution dedicated to advancing the field of artificial intelligence. Their research focuses on developing innovative computer vision techniques for a variety of applications.' },
    { heading: 'AI Developer', text: 'A highly skilled AI developer with expertise in natural language processing and machine learning.', moreInfo: 'AI Developer is a skilled professional with years of experience in developing AI solutions. Their expertise lies in natural language processing and machine learning, and they have developed several successful projects in these areas.' },
    // Add more directory entries here
  ].filter((entry) => entry.heading.toLowerCase().includes(searchQuery) || entry.text.toLowerCase().includes(searchQuery));
  directoryEntries.forEach((entry) => {
    const li = document.createElement('LI');
    li.innerHTML = `
      <h2>${entry.heading}</h2>
      <p>${entry.text}</p>
      <button class="more-info-btn">More Info</button>
      <div class="more-info-container">${entry.moreInfo}</div>
    `;
    directoryList.appendChild(li);
  });
  directoryList.querySelectorAll('.more-info-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const moreInfoContainer = btn.nextElementSibling;
      moreInfoContainer.classList.toggle('show');
    });
  });
});

moreInfoBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    const moreInfoContainer = btn.nextElementSibling;
    moreInfoContainer.classList.toggle('show');
  });
});