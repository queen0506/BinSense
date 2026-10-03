document.addEventListener('DOMContentLoaded', () => {
    const getStartedBtn = document.getElementById('getStartedBtn');

    // Redirect to the login page relative to the current location
    getStartedBtn.addEventListener('click', () => {
        window.location.href = 'login.html';
    });
});