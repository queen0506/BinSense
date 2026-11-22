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
    const feedbackModal = document.getElementById('feedbackModal');
    const bugModal = document.getElementById('bugModal');
    const logoutModal = document.getElementById('logoutModal');

    // --- 1. DISPLAY NAME ---
    const menuUserNameEl = document.getElementById('menu-user-name');
    supabase.auth.onAuthStateChange((_event, session) => {
        const user = session?.user;
        if (user && menuUserNameEl) {
            const displayName = user.user_metadata?.full_name || 'Collection Personnel';
            menuUserNameEl.textContent = `Hi, ${displayName}`;
        }
    });

    // --- 2. OPEN MODALS ---
    document.getElementById('openFeedback')?.addEventListener('click', (e) => {
        e.preventDefault();
        feedbackModal.style.display = 'flex';
    });

    document.getElementById('openBug')?.addEventListener('click', (e) => {
        e.preventDefault();
        bugModal.style.display = 'flex';
    });

    // --- 3. CLOSE MODALS ---
    const dismissFeedback = async () => {
        const comment = feedbackModal.querySelector('textarea');
        if ((currentRating || comment.value) && !await confirmDiscard('Your unsent feedback will be lost.')) return;
        comment.value = '';
        currentRating = 0;
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
    document.getElementById('cancelLogout')?.addEventListener('click', () => logoutModal.style.display = 'none');

    // --- 4. STAR RATING LOGIC ---
    let currentRating = 0;
    const stars = document.querySelectorAll('.star');
    stars.forEach(star => {
        star.onclick = () => {
            currentRating = parseInt(star.getAttribute('data-value'));
            stars.forEach((s, i) => {
                if (i < currentRating) {
                    s.classList.add('active');
                    s.style.color = "#99cc33";
                } else {
                    s.classList.remove('active');
                    s.style.color = "#ccc";
                }
            });
        };
    });

        // --- 5. SUBMIT FEEDBACK ---
    const feedbackBtn = feedbackModal?.querySelector('.btn-submit');
    if (feedbackBtn) {
        feedbackBtn.onclick = async () => {
            const text = document.getElementById('feedbackText').value.trim();

            if (currentRating < 1 || currentRating > 5) {
                showMenuPopup('warning', 'Rating Needed', 'Please select a rating from 1 to 5.');
                return;
            }
            if (!text) {
                showMenuPopup('warning', 'Message Needed', 'Please enter your feedback message.');
                document.getElementById('feedbackText').focus();
                return;
            }

            try {
                const { data: { user }, error: userError } = await supabase.auth.getUser();
                if (userError) throw userError;
                if (!user?.email) throw new Error('You must be logged in to send feedback.');

                const { error: dbError } = await supabase.from('feedbacks').insert({
                    email: user.email,
                    rating: currentRating,
                    message: text,
                    timestamp: new Date().toISOString()
                });
                if (dbError) throw dbError;

                await writeLog("Feedback", `Collector gave ${currentRating} stars`);

                // Clear and Close
                document.getElementById('feedbackText').value = "";
                stars.forEach(s => {
                    s.classList.remove('active');
                    s.style.color = "#ccc";
                });
                currentRating = 0;
                feedbackModal.style.display = 'none';
                showMenuPopup('success', 'Feedback Sent!', 'Thank you for helping us improve BinSense.');
            } catch (error) {
                console.error("Feedback Error:", error);
                showMenuPopup('error', 'Something Went Wrong', `Failed to send feedback: ${error.message || 'Please try again.'}`);
            }
        };
    }

    // --- 6. SUBMIT BUG REPORT ---
    const bugBtn = bugModal?.querySelector('.btn-submit');
    if (bugBtn) {
        bugBtn.onclick = async () => {
            const titleInput = bugModal.querySelector('input[type="text"]');
            const descInput = bugModal.querySelector('textarea');
            const severityInput = bugModal.querySelector('select');

            const title = titleInput.value.trim();
            const desc = descInput.value.trim();
            const severity = severityInput.value;

            if (!title || !desc || !severity) {
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
                    description: desc,
                    severity: severity,
                    timestamp: new Date().toISOString()
                });
                if (dbError) throw dbError;

                await writeLog("Bug Report", `New Bug from Collector: ${title}`);

                // Clear and Close
                titleInput.value = "";
                descInput.value = "";
                bugModal.style.display = 'none';
                showMenuPopup('success', 'Bug Report Sent!', 'Thanks! Our team will look into it.');
            } catch (error) {
                console.error("Bug Error:", error);
                showMenuPopup('error', 'Something Went Wrong', `Failed to submit bug report: ${error.message || 'Please try again.'}`);
            }
        };
    }

    // --- 7. LOGOUT (WITH CONFIRMATION) ---
    document.getElementById('menu-logout')?.addEventListener('click', (e) => {
        e.preventDefault();
        logoutModal.style.display = 'flex'; // Intercept and show modal
    });

    document.getElementById('confirmLogout')?.addEventListener('click', async () => {
        try {
            await writeLog("Logout", "User logged out from collection menu");
            const { error } = await supabase.auth.signOut();
            if (error) throw error;
            localStorage.clear();
            window.location.href = '../login.html';
        } catch (err) {
            console.error("Logout failed", err);
        }
    });

    // --- 8. CLICK OUTSIDE TO CLOSE ---
    window.addEventListener('click', (e) => {
        if (e.target === feedbackModal) dismissFeedback();
        if (e.target === bugModal) dismissBugReport();
        if (e.target === logoutModal) logoutModal.style.display = 'none';
    });
});