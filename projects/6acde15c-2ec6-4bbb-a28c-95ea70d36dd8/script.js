// Add event listener to back to top button
document.getElementById('back-to-top').addEventListener('click', () => {
  document.body.scrollTop = 0;
  document.documentElement.scrollTop = 0;
});

// Make elements scrollable
document.querySelectorAll('.image-grid').forEach(grid => {
  grid.style.overflowY = 'auto';
});

// Set up smooth scroll
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function(e) {
    e.preventDefault();
    document.querySelector(this.getAttribute('href')).scrollIntoView({
      behavior: 'smooth'
    });
  });
});

// Set up animation on scroll
const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isInter