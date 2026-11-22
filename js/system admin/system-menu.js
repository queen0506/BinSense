import { confirmDiscard } from '../action-confirmation.js';
import { supabase } from '../supabase-init.js';

document.addEventListener('DOMContentLoaded', () => {

    // ===== LOGOUT (UPDATED WITH MODAL) =====
    const logoutBtn = document.getElementById('menu-logout');
    const logoutModal = document.getElementById('logoutModal');
    const cancelLogout = document.getElementById('cancelLogout');
    const confirmLogout = document.getElementById('confirmLogout');

    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            logoutModal.style.display = 'flex'; // Show modal instead of logging out
        });
    }

    if (cancelLogout) {
        cancelLogout.addEventListener('click', () => {
            logoutModal.style.display = 'none';
        });
    }

    if (confirmLogout) {
        confirmLogout.addEventListener('click', () => {
            supabase.auth.signOut().then(() => {
                localStorage.clear();
                window.location.href = '../login.html';
            }).catch((error) => {
                console.error("Logout Error:", error);
            });
        });
    }

    // ===== SET USER DISPLAY NAME HEADER =====
    const menuUserNameEl = document.getElementById('menu-user-name');
    supabase.auth.onAuthStateChange((_event, session) => {
        const user = session?.user;
        if (user && menuUserNameEl) {
            const displayName = user.user_metadata?.full_name || 'User';
            menuUserNameEl.textContent = `Hi, ${displayName}`;
        }
    });

    // ===== FEEDBACK MODAL =====
    const feedbackModal = document.getElementById('feedbackModal');
    const openFeedback = document.getElementById('openFeedback');
    const feedbackSubmit = feedbackModal?.querySelector('.btn-submit');
    const feedbackText = feedbackModal?.querySelector('textarea'); 
    const stars = document.querySelectorAll('.star');

    let rating = 0;

    if (openFeedback) {
        openFeedback.addEventListener('click', (e) => {
            e.preventDefault();
            feedbackModal.style.display = 'flex';
        });
    }

    const dismissFeedback = async () => {
        const comment = feedbackModal.querySelector('textarea');
        if ((rating || comment.value) && !await confirmDiscard('Your unsent feedback will be lost.')) return;
        comment.value = '';
        rating = 0;
        stars.forEach(star => {
            star.classList.remove('active');
            star.style.removeProperty('color');
        });
        feedbackModal.style.display = 'none';
    };

    const dismissBugReport = async () => {
        const fields = [...bugModal.querySelectorAll('input[type="text"], textarea')];
        const severity = bugModal.querySelector('select');
        const hasDraft = fields.some(field => field.value) || severity.selectedIndex > 0;
        if (hasDraft && !await confirmDiscard('Your unsent bug report will be lost.')) return;
        fields.forEach(field => { field.value = ''; });
        severity.selectedIndex = 0;
        bugModal.style.display = 'none';
    };

    document.getElementById('cancelBtn')?.addEventListener('click', dismissFeedback);
    document.getElementById('cancelBug')?.addEventListener('click', dismissBugReport);

    if (feedbackSubmit) {
        feedbackSubmit.addEventListener('click', async () => {
            const { data: { user } } = await supabase.auth.getUser();
            const message = feedbackText.value.trim();

            if (rating === 0 && !message) {
                alert('Please provide a rating or a comment.');
                return;
            }

            try {
                const { error } = await supabase.from('feedbacks').insert({
                    email: user ? user.email : "Guest",
                    rating: Number(rating),
                    message: message,
                    timestamp: new Date().toISOString()
                });
                if (error) throw error;

                alert('Thanks for your feedback!');
                
                feedbackText.value = "";
                stars.forEach(s => s.classList.remove('active'));
                rating = 0;
                feedbackModal.style.display = 'none';
            } catch (error) {
                console.error("Feedback Error:", error);
                alert('Failed to send feedback. Please try again.');
            }
        });
    }

    stars.forEach(star => {
        star.addEventListener('click', () => {
            rating = star.getAttribute('data-value');
            stars.forEach(s => s.classList.remove('active'));

            for (let i = 0; i < rating; i++) {
                stars[i].classList.add('active');
            }
        });
    });

    // ===== BUG MODAL =====
    const bugModal = document.getElementById('bugModal');
    const openBug = document.getElementById('openBug');
    const bugSubmit = bugModal?.querySelector('.btn-submit');
    
    const bugTitle = bugModal?.querySelector('.bug-input');
    const bugDesc = bugModal?.querySelector('textarea');
    const bugSeverity = bugModal?.querySelector('.bug-select');

    if (openBug) {
        openBug.addEventListener('click', (e) => {
            e.preventDefault();
            bugModal.style.display = 'flex';
        });
    }


    if (bugSubmit) {
        bugSubmit.addEventListener('click', async () => {
            const { data: { user } } = await supabase.auth.getUser();
            const title = bugTitle.value.trim();
            const description = bugDesc.value.trim();

            if (!title || !description) {
                alert('Please fill in both the title and description.');
                return;
            }

            try {
                const { error } = await supabase.from('incident_reports').insert({
                    email: user ? user.email : 'Guest',
                    title: title,
                    description: description,
                    severity: bugSeverity.value,
                    timestamp: new Date().toISOString()
                });
                if (error) throw error;

                alert('Bug report submitted. Thank you!');
                
                bugTitle.value = "";
                bugDesc.value = "";
                bugModal.style.display = 'none';
            } catch (error) {
                console.error("Bug Report Error:", error);
                alert('Failed to submit bug report.');
            }
        });
    }

    // ===== CLICK OUTSIDE =====
    window.addEventListener('click', (e) => {
        if (e.target === feedbackModal) dismissFeedback();
        if (e.target === bugModal) dismissBugReport();
        if (e.target === logoutModal) logoutModal.style.display = 'none';
    });

});