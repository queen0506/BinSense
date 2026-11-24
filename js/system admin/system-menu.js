import { confirmDiscard } from '../action-confirmation.js';
import { supabase } from '../supabase-init.js';

// POP UP ICONS
const POPUP_ICONS = {
    success: '<svg viewBox="0 0 24 24"><polyline points="4 12 10 18 20 6"></polyline></svg>',
    error:   '<svg viewBox="0 0 24 24"><line x1="6" y1="6" x2="18" y2="18"></line><line x1="18" y1="6" x2="6" y2="18"></line></svg>',
    warning: '<svg viewBox="0 0 24 24"><line x1="12" y1="6" x2="12" y2="13"></line><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>'
};

function showMenuPopup(type, title, message) {
    const overlay = document.getElementById('menu-popup');
    const box = document.getElementById('menu-popup-box');
    const btn = document.getElementById('menu-popup-close');
    if (!overlay) return;

    box.className = `menu-popup-box ${type}`;
    document.getElementById('menu-popup-icon').innerHTML = POPUP_ICONS[type];
    document.getElementById('menu-popup-title').textContent = title;
    document.getElementById('menu-popup-text').textContent = message;
    overlay.classList.add('show');

    const close = () => {
        overlay.classList.remove('show');
        btn.removeEventListener('click', close);
    };
    btn.addEventListener('click', close);
}

// Helper for System Logs & Audits
async function writeLog(action, message) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    try {
        await supabase.from('system_logs').insert({
            email: user.email,
            action: action,
            message: message,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.error("Log error:", err);
    }
}

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
            const message = feedbackText.value.trim();

            if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
                showMenuPopup('warning', 'Rating Needed', 'Please select a rating from 1 to 5.');
                return;
            }
            if (!message) {
                showMenuPopup('warning', 'Message Needed', 'Please enter your feedback message.');
                feedbackText.focus();
                return;
            }

            try {
                const { data: { user }, error: userError } = await supabase.auth.getUser();
                if (userError) throw userError;
                if (!user?.email) throw new Error('You must be logged in to send feedback.');

                const { error: dbError } = await supabase.from('feedbacks').insert({
                    email: user.email,
                    rating: rating,
                    message: message,
                    timestamp: new Date().toISOString()
                });
                if (dbError) throw dbError;

                await writeLog("Feedback", `System Admin gave ${rating} stars`);

                // Clear and Close
                feedbackText.value = "";
                stars.forEach(s => {
                    s.classList.remove('active');
                    s.style.removeProperty('color');
                });
                rating = 0;
                feedbackModal.style.display = 'none';
                showMenuPopup('success', 'Feedback Sent!', 'Thank you for helping us improve BinSense.');
            } catch (error) {
                console.error("Feedback Error:", error);
                showMenuPopup('error', 'Something Went Wrong', `Failed to send feedback: ${error.message || 'Please try again.'}`);
            }
        });
    }

    stars.forEach(star => {
        star.addEventListener('click', () => {
            rating = parseInt(star.getAttribute('data-value'));
            stars.forEach((s, i) => {
                s.classList.toggle('active', i < rating);
                s.style.color = i < rating ? "#99cc33" : "#ccc";
            });
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
            const title = bugTitle.value.trim();
            const description = bugDesc.value.trim();
            const severity = bugSeverity.value;

            if (!title || !description || !severity) {
                showMenuPopup('warning', 'Missing Details', 'Please provide a title, description, and severity.');
                return;
            }

            try {
                const { data: { user }, error: userError } = await supabase.auth.getUser();
                if (userError) throw userError;
                if (!user?.email) throw new Error('You must be logged in to report a bug.');

                const { error: dbError } = await supabase.from('incident_reports').insert({
                    email: user.email,
                    title: title,
                    description: description,
                    severity: severity,
                    timestamp: new Date().toISOString()
                });
                if (dbError) throw dbError;

                await writeLog("Bug Report", `New Bug from System Admin: ${title}`);

                // Clear and Close
                bugTitle.value = "";
                bugDesc.value = "";
                bugSeverity.selectedIndex = 0;
                bugModal.style.display = 'none';
                showMenuPopup('success', 'Bug Report Sent!', 'Thanks! Our team will look into it.');
            } catch (error) {
                console.error("Bug Report Error:", error);
                showMenuPopup('error', 'Something Went Wrong', `Failed to submit bug report: ${error.message || 'Please try again.'}`);
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