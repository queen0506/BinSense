document.addEventListener('DOMContentLoaded', () => {
    const getStartedBtn = document.getElementById('getStartedBtn');

    // Redirect to the login page relative to the current location
    getStartedBtn.addEventListener('click', () => {
        // Use a relative path that matches your deployed structure
        window.location.href = 'html/login.html';
    });
});