const posts = [
    {
        title: "Explore the Mountains: A Journey",
        author: "John Doe",
        date: "2023-10-01",
        readTime: "5 min read",
        category: "Travel",
        content: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua..."
    },
    {
        title: "Working from Home: Tips and Tricks",
        author: "Jane Smith",
        date: "2023-09-20",
        readTime: "7 min read",
        category: "Work",
        content: "At vero eos et accusamus et iusto odio dignissimos ducimus qui blanditiis praesentium voluptatum deleniti atque corrupti quos dolores et quas molestias excepturi sint occaecati cupiditate non provident..."
    },
    {
        title: "Personal Growth: Finding Your Path",
        author: "Alice Johnson",
        date: "2023-08-15",
        readTime: "4 min read",
        category: "Personal",
        content: "Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur magni dolores eos qui ratione voluptatem sequi nesciunt..."
    }
];

const postList = document.querySelector('.post-list');
const recentPosts = document.getElementById('recent-posts');
const searchInput = document.getElementById('search');

// Function to render posts
function renderPosts(filter = 'all') {
    postList.innerHTML = '';
    recentPosts.innerHTML = '';
    const filteredPosts = posts.filter(post => filter === 'all' || post.category.toLowerCase() === filter);

    filteredPosts.forEach(post => {
        const postElement = document.createElement('article');
        postElement.className = 'post';
        postElement.innerHTML = `
            <h3>${post.title}</h3>
            <p class="meta">By ${post.author} | ${post.date} | ${post.readTime} | Category: ${post.category}</p>
            <p>${post.content.substring(0, 100)}...</p>
        `;
        postElement.onclick = () => viewPost(post);
        postList.appendChild(postElement);

        const recentElement = document.createElement('li');
        recentElement.innerText = post.title;
        recentPosts.appendChild(recentElement);
    });
}

// Function to view individual post
function viewPost(post) {
    postList.innerHTML = `
        <article class="post">
            <h3>${post.title}</h3>
            <p class="meta">By ${post.author} | ${post.date} | ${post.readTime} | Category: ${post.category}</p>
            <p>${post.content}</p>
        </article>
    `;
}

// Search functionality
searchInput.addEventListener('input', () => {
    const searchTerm = searchInput.value.toLowerCase();
    const filteredPosts = posts.filter(post => post.title.toLowerCase().includes(searchTerm));
    renderPosts(filteredPosts.length > 0 ? 'all' : 'none');
});

// Category filter
document.querySelectorAll('.category').forEach(button => {
    button.addEventListener('click', () => {
        const category = button.getAttribute('data-category');
        renderPosts(category);
    });
});

// Dark/Light mode toggle
const toggleButton = document.getElementById('toggleMode');
toggleButton.addEventListener('click', () => {
    document.body.classList.toggle('dark-mode');
});

// Initial render
renderPosts();