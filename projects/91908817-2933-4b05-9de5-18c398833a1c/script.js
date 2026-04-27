document.addEventListener('DOMContentLoaded', () => {
    // Chart.js code here
});

const userActivityData = {
    labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    datasets: [
        {
            label: 'Users',
            data: [350, 420, 380, 450, 400, 360, 480],
            backgroundColor: ['#4caf50', '#4caf50', '#4caf50', '#4caf50', '#4caf50', '#4caf50', '#4caf50'],
            borderColor: 'transparent',
            borderWidth: 3
        }
    ]
};

const salesOverviewData = {
    labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    datasets: [
        {
            label: 'Sales',
            data: [2500, 3200, 2800, 3500, 3200, 2700, 3800, 4000, 3600, 3300, 3000, 2800],
            backgroundColor: ['#f44336', '#f44336', '#f44336', '#f44336', '#f44336', '#f44336', '#f44336', '#f44336', '#f44336', '#f44336', '#f44336', '#f44336'],
            borderColor: 'transparent',
            borderWidth: 3
        }
    ]
};

const deviceBreakdownData = {
    labels: ['Desktop', 'Tablet', 'Mobile'],
    datasets: [
        {
            label: 'Devices',
            data: [600, 300, 450],
            backgroundColor: ['#2196f3', '#9c27b0', '#ffeb3b'],
            borderColor: 'transparent',
            borderWidth: 3
        }
    ]
};

function createChart("userActivityChart", userActivityData);
function createChart("salesOverviewChart", salesOverviewData);
function createChart("deviceBreakdownChart", deviceBreakdownData);

function createChart(chartId, chartData) {
    const ctx = document.getElementById(chartId).getContext('2d');
    new Chart(ctx, {
        type: 'bar', // or 'line', 'pie', etc.
        data: chartData,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                yAxes: [
                    {
                        ticks: {
                            beginAtZero: true
                        }
                    }
                ]
            }
        }
    });
}