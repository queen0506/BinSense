document.addEventListener('DOMContentLoaded', () => {
    const getStartedBtn = document.getElementById('getStartedBtn');

    // Redirect to the login page relative to the current location
    getStartedBtn.addEventListener('click', () => {
        window.location.href = 'login.html';
    });

    const scrollContainer = document.querySelector('.scroll-container');
    const revealItems = document.querySelectorAll('.reveal');
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if ('IntersectionObserver' in window && scrollContainer && !prefersReducedMotion) {
        document.body.classList.add('reveal-ready');

        const observer = new IntersectionObserver((entries, currentObserver) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('is-visible');
                    currentObserver.unobserve(entry.target);
                }
            });
        }, {
            root: scrollContainer,
            threshold: 0.12,
            rootMargin: '0px 0px -6% 0px'
        });

        revealItems.forEach((item) => observer.observe(item));
    }
});